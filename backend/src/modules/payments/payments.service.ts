import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { DateTime } from 'luxon';
import { DataSource, EntityManager } from 'typeorm';
import { Commission, CommissionRule, Payment, PaymentMethod, PaymentStatus, ProviderType, Refund } from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { likeEscape, paginate, skipTake } from '../../common/dto/pagination.dto';
import { humanCode } from '../../common/utils/codes';
import { calculateCommission, pickRule } from '../../common/utils/commission';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { SettingsService } from '../settings/settings.service';
import { PdfService, esc } from '../pdf/pdf.service';
import { PAYMENT_GATEWAYS, PaymentGateway, GatewayResult } from './gateways/gateway';
import { SandboxGateway } from './gateways/sandbox.gateway';
import { refundSplit, safeEqual } from './payments-logic';
import { PaymentsQuery } from './payments.dto';

interface Meta {
  ip?: string;
  userAgent?: string | null;
}

/** What the ledger needs to know about a payable record. */
export interface Payable {
  entityType: string;
  id: string;
  code: string;
  patientId: string | null;
  patientUserId: string | null;
  providerId: string;
  amount: number;
  paymentStatus: PaymentStatus;
  status: string;
  /** Can be paid online right now. */
  payable: boolean;
  description: string;
  /** Realtime event to refresh the record's screens. */
  event: string;
}

const ROUND = (n: number) => Math.round(n * 100) / 100;
export const ENTITY_LABEL: Record<string, string> = {
  APPOINTMENT: 'كشف',
  LAB_ORDER: 'تحاليل',
  RADIOLOGY_ORDER: 'أشعة',
  PHARMACY_ORDER: 'طلب صيدلية',
  SUBSCRIPTION: 'اشتراك',
};
export const METHOD_AR: Record<string, string> = { CASH: 'نقدي', CARD: 'بطاقة', ONLINE: 'دفع إلكتروني', WALLET: 'محفظة' };
export const STATUS_AR: Record<string, string> = { PENDING: 'قيد الدفع', PAID: 'مدفوع', FAILED: 'فشل', REFUNDED: 'مسترد', PARTIALLY_REFUNDED: 'مسترد جزئياً' };

/**
 * The money ledger. Every payment — cash at the desk, online, or a provider's subscription —
 * becomes a `payments` row with a commission snapshot, so revenue, commission, refunds and
 * provider balances all come from one place. Gateways sit behind the PaymentGateway interface.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly gatewayName: string;
  readonly tz: string;

  constructor(
    private ds: DataSource,
    config: ConfigService,
    private moduleRef: ModuleRef,
    private audit: AuditService,
    private notifications: NotificationsService,
    private realtime: NotificationsGateway,
    private settings: SettingsService,
    private pdf: PdfService,
    private sandbox: SandboxGateway,
    @Inject(PAYMENT_GATEWAYS) private gateways: PaymentGateway[],
  ) {
    this.gatewayName = config.get<string>('payment.gateway')!;
    this.tz = config.get<string>('timezone')!;
  }

  // ─────────────── Gateways ───────────────

  gateway(name = this.gatewayName): PaymentGateway | null {
    const g = this.gateways.find((x) => x.name === name);
    return g && g.isConfigured() ? g : null;
  }

  async onlineAvailable() {
    return !!this.gateway() && (await this.settings.get<boolean>('payments.onlineEnabled'));
  }

  async config() {
    const g = this.gateway();
    return {
      online: await this.onlineAvailable(),
      gateway: g?.name ?? null,
      gatewayLabel: g?.label ?? null,
      instapay: await this.settings.get<string>('payments.instapay'),
      vodafoneCash: await this.settings.get<string>('payments.vodafoneCash'),
      bankAccount: await this.settings.get<string>('payments.bankAccount'),
    };
  }

  // ─────────────── Payable records ───────────────

  async payable(m: EntityManager, entityType: string, id: string, lock = false): Promise<Payable | null> {
    const fu = lock ? 'FOR UPDATE OF x' : '';
    let r: any;
    if (entityType === 'APPOINTMENT') {
      [r] = await m.query(
        `SELECT x.id, x.code, x.patient_id, pa.user_id AS patient_user_id, x.provider_id, x.final_price::float AS amount, x.payment_status, x.status, pr.name_ar
           FROM appointments x JOIN patients pa ON pa.id = x.patient_id JOIN providers pr ON pr.id = x.provider_id WHERE x.id = $1 ${fu}`,
        [id],
      );
      if (!r) return null;
      return this.shape(r, entityType, ['PENDING', 'CONFIRMED'].includes(r.status), `كشف لدى ${r.name_ar}`, 'appointment:update');
    }
    if (entityType === 'LAB_ORDER') {
      [r] = await m.query(
        `SELECT x.id, x.code, x.patient_id, pa.user_id AS patient_user_id, l.provider_id, x.total::float AS amount, x.payment_status, x.status, pr.name_ar
           FROM lab_orders x JOIN laboratories l ON l.id = x.laboratory_id JOIN patients pa ON pa.id = x.patient_id JOIN providers pr ON pr.id = l.provider_id WHERE x.id = $1 ${fu}`,
        [id],
      );
      if (!r) return null;
      return this.shape(r, entityType, !['CANCELLED', 'APPROVED', 'DELIVERED'].includes(r.status), `تحاليل لدى ${r.name_ar}`, 'lab:order');
    }
    if (entityType === 'RADIOLOGY_ORDER') {
      [r] = await m.query(
        `SELECT x.id, x.code, x.patient_id, pa.user_id AS patient_user_id, c.provider_id, (x.price - x.discount)::float AS amount, x.payment_status, x.status, pr.name_ar
           FROM radiology_orders x JOIN radiology_centers c ON c.id = x.center_id JOIN patients pa ON pa.id = x.patient_id JOIN providers pr ON pr.id = c.provider_id WHERE x.id = $1 ${fu}`,
        [id],
      );
      if (!r) return null;
      return this.shape(r, entityType, ['BOOKED', 'CHECKED_IN', 'EXAMINATION', 'REPORTING'].includes(r.status), `أشعة لدى ${r.name_ar}`, 'radiology:order');
    }
    if (entityType === 'PHARMACY_ORDER') {
      [r] = await m.query(
        `SELECT x.id, x.code, x.patient_id, pa.user_id AS patient_user_id, ph.provider_id, x.total::float AS amount, x.payment_status, x.status, pr.name_ar
           FROM pharmacy_orders x JOIN pharmacies ph ON ph.id = x.pharmacy_id JOIN patients pa ON pa.id = x.patient_id JOIN providers pr ON pr.id = ph.provider_id WHERE x.id = $1 ${fu}`,
        [id],
      );
      if (!r) return null;
      return this.shape(r, entityType, ['CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'].includes(r.status), `طلب صيدلية من ${r.name_ar}`, 'pharmacy:order');
    }
    if (entityType === 'SUBSCRIPTION') {
      [r] = await m.query(
        `SELECT x.id, x.code, NULL AS patient_id, NULL AS patient_user_id, x.provider_id, x.total::float AS amount,
                CASE WHEN x.status = 'PAID' THEN 'PAID' ELSE 'PENDING' END AS payment_status, x.status, pl.name_ar
           FROM subscription_invoices x LEFT JOIN subscription_plans pl ON pl.id = x.plan_id WHERE x.id = $1 ${fu}`,
        [id],
      );
      if (!r) return null;
      return this.shape(r, entityType, r.status === 'PENDING', `اشتراك ${r.name_ar ?? ''}`.trim(), 'subscription:update');
    }
    return null;
  }

  private shape(r: any, entityType: string, open: boolean, description: string, event: string): Payable {
    return {
      entityType,
      id: r.id,
      code: r.code,
      patientId: r.patient_id,
      patientUserId: r.patient_user_id,
      providerId: r.provider_id,
      amount: Number(r.amount),
      paymentStatus: r.payment_status,
      status: r.status,
      payable: open && r.payment_status === 'PENDING' && Number(r.amount) > 0,
      description,
      event,
    };
  }

  /** Writes the paid state onto the business record. */
  private async markRecordPaid(m: EntityManager, p: Payable, method: PaymentMethod, by: string | null) {
    const now = new Date();
    if (p.entityType === 'APPOINTMENT') {
      await m.query(`UPDATE appointments SET payment_status = 'PAID', payment_method = $2 WHERE id = $1`, [p.id, method]);
    } else if (p.entityType === 'LAB_ORDER') {
      await m.query(`UPDATE lab_orders SET payment_status = 'PAID', payment_method = $2, paid_at = $3 WHERE id = $1`, [p.id, method, now]);
      if (p.status === 'NEW_ORDER') {
        await m.query(`UPDATE lab_orders SET status = 'PAID' WHERE id = $1`, [p.id]);
        await m.query(`INSERT INTO lab_order_status_history (order_id, from_status, to_status, changed_by_id, note) VALUES ($1, 'NEW_ORDER', 'PAID', $2, 'دفع إلكتروني')`, [p.id, by]);
      }
    } else if (p.entityType === 'RADIOLOGY_ORDER') {
      await m.query(`UPDATE radiology_orders SET payment_status = 'PAID', payment_method = $2, paid_at = $3 WHERE id = $1`, [p.id, method, now]);
    } else if (p.entityType === 'PHARMACY_ORDER') {
      await m.query(`UPDATE pharmacy_orders SET payment_status = 'PAID', payment_method = $2, paid_at = $3 WHERE id = $1`, [p.id, method, now]);
    }
  }

  private async setRecordPaymentStatus(m: EntityManager, entityType: string, id: string, status: PaymentStatus) {
    const table = { APPOINTMENT: 'appointments', LAB_ORDER: 'lab_orders', RADIOLOGY_ORDER: 'radiology_orders', PHARMACY_ORDER: 'pharmacy_orders' }[entityType];
    if (table) await m.query(`UPDATE ${table} SET payment_status = $2 WHERE id = $1`, [id, status]);
  }

  private async teamUserIds(providerId: string): Promise<string[]> {
    const rows: { id: string }[] = await this.ds.query(
      `SELECT owner_user_id AS id FROM providers WHERE id = $1 UNION SELECT user_id FROM provider_staff WHERE provider_id = $1 AND is_active`,
      [providerId],
    );
    return rows.map((r) => r.id);
  }

  private async emit(p: Payable) {
    const users = [...(await this.teamUserIds(p.providerId)), ...(p.patientUserId ? [p.patientUserId] : [])];
    this.realtime.emitToUsers(users, p.event, { id: p.id, status: p.status });
    this.realtime.emitToUsers(users, 'payment:update', { entityType: p.entityType, entityId: p.id });
  }

  // ─────────────── Commission ───────────────

  private async commissionFor(m: EntityManager, payment: Payment) {
    if (payment.entityType === 'SUBSCRIPTION') return; // platform revenue, nothing to split
    const [prov] = await m.query(`SELECT type FROM providers WHERE id = $1`, [payment.providerId]);
    const rules = await m.find(CommissionRule, { where: { isActive: true } });
    const c = calculateCommission(Number(payment.amount), pickRule(rules, payment.providerId, prov?.type as ProviderType));
    await m.insert(Commission, {
      paymentId: payment.id,
      ruleId: c.ruleId,
      grossAmount: c.gross,
      commissionAmount: c.commission,
      providerAmount: c.provider,
      providerId: payment.providerId,
      entityType: payment.entityType,
    });
  }

  // ─────────────── Offline payments (desk) ───────────────

  /**
   * Called inside the module's own transaction when staff record cash/card at the desk
   * (or a pharmacy delivery is paid on the door). Idempotent per record.
   */
  async recordOffline(m: EntityManager, entityType: string, entityId: string, method: PaymentMethod, recordedById: string | null) {
    const p = await this.payable(m, entityType, entityId);
    if (!p || p.amount <= 0) return null;
    const [existing] = await m.query(`SELECT id FROM payments WHERE entity_type = $1 AND entity_id = $2 AND status IN ('PAID','PARTIALLY_REFUNDED')`, [entityType, entityId]);
    if (existing) return existing.id as string;
    const payment = await m.save(
      m.create(Payment, {
        code: humanCode('PAY'),
        patientId: p.patientId,
        providerId: p.providerId,
        appointmentId: entityType === 'APPOINTMENT' ? entityId : null,
        entityType,
        entityId,
        method,
        status: PaymentStatus.PAID,
        amount: p.amount,
        currency: 'EGP',
        gateway: null,
        paidAt: new Date(),
        payerUserId: p.patientUserId,
        description: p.description,
        collectedBy: 'PROVIDER',
        recordedById,
      }),
    );
    await this.commissionFor(m, payment);
    return payment.id;
  }

  /** Re-points a payment when an appointment is rescheduled into a new record. */
  async movePayments(m: EntityManager, entityType: string, fromId: string, toId: string) {
    await m.query(`UPDATE payments SET entity_id = $3, appointment_id = CASE WHEN $1 = 'APPOINTMENT' THEN $3::uuid ELSE appointment_id END WHERE entity_type = $1 AND entity_id = $2`, [entityType, fromId, toId]);
  }

  // ─────────────── Online checkout ───────────────

  async checkout(user: AuthUser, entityType: string, entityId: string, meta: Meta = {}) {
    if (!(await this.onlineAvailable())) throw new ServiceUnavailableException({ message: 'الدفع الإلكتروني غير متاح حالياً — ادفع عند مقدم الخدمة', code: 'ONLINE_DISABLED' });
    const g = this.gateway()!;
    const { payment, p } = await this.ds.transaction(async (m) => {
      const p = await this.payable(m, entityType, entityId, true);
      if (!p || !user.patientId || p.patientId !== user.patientId) throw new NotFoundException('غير موجود');
      if (p.paymentStatus === PaymentStatus.PAID) throw new ConflictException({ message: 'تم الدفع بالفعل', code: 'ALREADY_PAID' });
      if (!p.payable) throw new BadRequestException({ message: p.entityType === 'PHARMACY_ORDER' && p.status === 'PENDING' ? 'انتظر تأكيد الصيدلية للسعر النهائي قبل الدفع' : 'لا يمكن الدفع لهذا الطلب الآن', code: 'NOT_PAYABLE' });
      return { payment: await this.newPending(m, p, user.id, g.name), p };
    });
    return this.openSession(g, payment, p, user, meta);
  }

  /** Subscriptions create their invoice, then reuse the same checkout. */
  async checkoutSubscription(m: EntityManager, user: AuthUser, invoiceId: string) {
    const g = this.gateway();
    if (!g || !(await this.settings.get<boolean>('payments.onlineEnabled'))) throw new ServiceUnavailableException({ message: 'الدفع الإلكتروني غير متاح حالياً — استخدم التحويل', code: 'ONLINE_DISABLED' });
    const p = (await this.payable(m, 'SUBSCRIPTION', invoiceId, true))!;
    return { payment: await this.newPending(m, p, user.id, g.name), p, g };
  }

  private async newPending(m: EntityManager, p: Payable, payerUserId: string, gateway: string) {
    // One live attempt per record: older pending attempts are abandoned.
    await m.query(`UPDATE payments SET status = 'FAILED', failure_reason = 'تم بدء محاولة دفع جديدة' WHERE entity_type = $1 AND entity_id = $2 AND status = 'PENDING'`, [p.entityType, p.id]);
    return m.save(
      m.create(Payment, {
        code: humanCode('PAY'),
        patientId: p.patientId,
        providerId: p.providerId,
        appointmentId: p.entityType === 'APPOINTMENT' ? p.id : null,
        entityType: p.entityType,
        entityId: p.id,
        method: PaymentMethod.ONLINE,
        status: PaymentStatus.PENDING,
        amount: p.amount,
        currency: 'EGP',
        gateway,
        payerUserId,
        description: p.description,
        collectedBy: 'PLATFORM',
      }),
    );
  }

  async openSession(g: PaymentGateway, payment: Payment, p: Payable, user: AuthUser, meta: Meta = {}) {
    const [u] = await this.ds.query(`SELECT full_name, phone, email FROM users WHERE id = $1`, [user.id]);
    try {
      const session = await g.createCheckout({ paymentId: payment.id, code: payment.code, amount: Number(payment.amount), currency: 'EGP', description: p.description, customer: { name: u.full_name, phone: u.phone, email: u.email } });
      await this.ds.query(`UPDATE payments SET gateway_reference = $2 WHERE id = $1`, [payment.id, session.reference]);
      await this.audit.log({ userId: user.id, action: 'PAYMENT_CHECKOUT_STARTED', entity: 'payments', entityId: payment.id, newValue: { entityType: p.entityType, entityId: p.id, amount: payment.amount, gateway: g.name }, ...meta });
      return { paymentId: payment.id, code: payment.code, amount: Number(payment.amount), redirectUrl: session.redirectUrl };
    } catch (e: any) {
      await this.ds.query(`UPDATE payments SET status = 'FAILED', failure_reason = $2 WHERE id = $1`, [payment.id, String(e.message).slice(0, 300)]);
      throw e;
    }
  }

  /** Sandbox checkout page details (only with a valid signature). */
  async sandboxInfo(id: string, sig: string) {
    const pay = await this.ds.getRepository(Payment).findOneBy({ id });
    if (!pay || pay.gateway !== 'sandbox' || !safeEqual(this.sandbox.sign(pay.id, Number(pay.amount)), sig)) throw new NotFoundException('رابط الدفع غير صالح');
    const [pr] = await this.ds.query(`SELECT name_ar FROM providers WHERE id = $1`, [pay.providerId]);
    return { id: pay.id, code: pay.code, amount: Number(pay.amount), currency: pay.currency, description: pay.description, provider: pr?.name_ar, status: pay.status, entityType: pay.entityType, entityId: pay.entityId };
  }

  /** The sandbox "bank": 4000 0000 0000 0002 is declined, any other valid number is approved. */
  async sandboxComplete(id: string, sig: string, card: string) {
    await this.sandboxInfo(id, sig);
    const declined = card.startsWith('4000000000000002');
    const pay = (await this.ds.getRepository(Payment).findOneBy({ id }))!;
    return this.complete({ code: pay.code, success: !declined, transactionId: `SBX-${Date.now()}`, failureReason: declined ? 'رفض البنك العملية (بطاقة تجريبية مرفوضة)' : undefined }, 'sandbox');
  }

  /**
   * Gateway result → ledger. Idempotent and serialised on the payment row. If the record
   * can no longer take the money (cancelled or already paid at the desk meanwhile), the
   * payment is refunded automatically.
   */
  async complete(result: GatewayResult, gatewayName: string) {
    const out = await this.ds.transaction(async (m) => {
      const pay = await m.findOne(Payment, { where: { code: result.code }, lock: { mode: 'pessimistic_write' } });
      if (!pay || pay.gateway !== gatewayName) throw new NotFoundException('عملية دفع غير معروفة');
      if (pay.status !== PaymentStatus.PENDING) return { pay, changed: false, refundNeeded: false, p: null as Payable | null };
      if (result.amount != null && Math.abs(result.amount - Number(pay.amount)) > 0.01) {
        await m.update(Payment, pay.id, { status: PaymentStatus.FAILED, failureReason: 'المبلغ المدفوع لا يطابق المطلوب', gatewayReference: result.transactionId });
        return { pay, changed: true, refundNeeded: false, p: null };
      }
      if (!result.success) {
        await m.update(Payment, pay.id, { status: PaymentStatus.FAILED, failureReason: result.failureReason ?? 'فشلت عملية الدفع', gatewayReference: result.transactionId });
        return { pay: { ...pay, status: PaymentStatus.FAILED }, changed: true, refundNeeded: false, p: await this.payable(m, pay.entityType, pay.entityId) };
      }
      const p = await this.payable(m, pay.entityType, pay.entityId, true);
      await m.update(Payment, pay.id, { status: PaymentStatus.PAID, paidAt: new Date(), gatewayReference: result.transactionId });
      const paid = { ...pay, status: PaymentStatus.PAID } as Payment;
      await this.commissionFor(m, paid);
      await this.audit.log({ userId: pay.payerUserId, action: 'PAYMENT_SUCCEEDED', entity: 'payments', entityId: pay.id, newValue: { amount: pay.amount, entityType: pay.entityType, entityId: pay.entityId, gateway: gatewayName } }, m);
      if (!p) return { pay: paid, changed: true, refundNeeded: true, p: null };
      if (p.entityType === 'SUBSCRIPTION') {
        if (p.status !== 'PENDING') return { pay: paid, changed: true, refundNeeded: true, p };
        const { SubscriptionsService } = await import('../subscriptions/subscriptions.service');
        await this.moduleRef.get(SubscriptionsService, { strict: false }).activateInvoice(m, p.id, pay.id, pay.payerUserId);
        return { pay: paid, changed: true, refundNeeded: false, p };
      }
      if (!p.payable) return { pay: paid, changed: true, refundNeeded: true, p };
      await this.markRecordPaid(m, p, PaymentMethod.ONLINE, pay.payerUserId);
      return { pay: paid, changed: true, refundNeeded: false, p };
    });
    if (out.changed && out.refundNeeded) {
      await this.refund(null, out.pay.id, { reason: 'تم الدفع بعد إلغاء الطلب أو سداده بطريقة أخرى — استرداد تلقائي' }).catch((e) => this.logger.error(`Auto-refund ${out.pay.code} failed: ${e.message}`));
    } else if (out.changed && out.p) {
      await this.afterPaymentNotify(out.pay as Payment, out.p);
      await this.emit(out.p);
    }
    return { paymentId: out.pay.id, status: (await this.ds.getRepository(Payment).findOneBy({ id: out.pay.id }))!.status, entityType: out.pay.entityType, entityId: out.pay.entityId };
  }

  private async afterPaymentNotify(pay: Payment, p: Payable) {
    const ok = pay.status === PaymentStatus.PAID;
    if (pay.payerUserId) {
      await this.notifications.notify(pay.payerUserId, {
        type: ok ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_FAILED',
        category: 'PAYMENTS',
        title: ok ? 'تم الدفع بنجاح' : 'لم تكتمل عملية الدفع',
        body: ok ? `تم دفع ${Number(pay.amount)} ج.م — ${p.description} (${p.code}). رقم العملية ${pay.code}.` : `${p.description} (${p.code}): ${pay.failureReason ?? 'فشلت العملية'}. يمكنك المحاولة مرة أخرى.`,
        data: { paymentId: pay.id, entityType: p.entityType, entityId: p.id },
      });
    }
    if (ok && p.entityType !== 'SUBSCRIPTION') {
      await this.notifications.notifyMany(await this.teamUserIds(p.providerId), {
        type: 'PAYMENT_RECEIVED',
        category: 'PAYMENTS',
        title: 'دفع إلكتروني',
        body: `دفع المريض ${Number(pay.amount)} ج.م إلكترونياً — ${ENTITY_LABEL[p.entityType]} ${p.code}.`,
        data: { paymentId: pay.id, entityType: p.entityType, entityId: p.id },
      });
    }
  }

  // ─────────────── Refunds ───────────────

  /**
   * Full or partial refund. Online payments are refunded through their gateway; cash
   * payments are recorded (the provider hands the money back). Commission is reversed
   * proportionally so balances stay right.
   */
  async refund(user: AuthUser | null, paymentId: string, dto: { amount?: number; reason: string }, meta: Meta = {}) {
    const res = await this.ds.transaction(async (m) => {
      const pay = await m.findOne(Payment, { where: { id: paymentId }, lock: { mode: 'pessimistic_write' } });
      if (!pay) throw new NotFoundException('عملية الدفع غير موجودة');
      if (![PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED].includes(pay.status)) throw new BadRequestException('لا يمكن استرداد عملية غير مدفوعة');
      const left = ROUND(Number(pay.amount) - Number(pay.refundedAmount));
      const amount = ROUND(dto.amount ?? left);
      if (amount <= 0 || amount > left + 0.001) throw new BadRequestException(`أقصى مبلغ يمكن استرداده ${left} ج.م`);
      let reference: string | null = null;
      if (pay.method === PaymentMethod.ONLINE && pay.gateway) {
        const g = this.gateways.find((x) => x.name === pay.gateway);
        if (!g) throw new ServiceUnavailableException('بوابة الدفع غير متاحة للاسترداد الآن');
        const r = await g.refund(pay.gatewayReference ?? '', amount);
        if (!r.ok) {
          await m.insert(Refund, { paymentId: pay.id, amount, reason: dto.reason, processedById: user?.id ?? null, status: 'FAILED' });
          throw new ServiceUnavailableException(`تعذر الاسترداد عبر البوابة: ${r.error ?? ''}`);
        }
        reference = r.reference;
      }
      await m.insert(Refund, { paymentId: pay.id, amount, reason: dto.reason, processedById: user?.id ?? null, status: 'COMPLETED', gatewayReference: reference });
      const refunded = ROUND(Number(pay.refundedAmount) + amount);
      const status = refunded >= Number(pay.amount) - 0.001 ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
      await m.update(Payment, pay.id, { refundedAmount: refunded, status });
      const c = await m.findOne(Commission, { where: { paymentId: pay.id } });
      if (c) {
        const s = refundSplit(c, amount);
        await m.update(Commission, c.id, { reversedCommission: ROUND(Number(c.reversedCommission) + s.commission), reversedProviderAmount: ROUND(Number(c.reversedProviderAmount) + s.provider) });
      }
      await this.setRecordPaymentStatus(m, pay.entityType, pay.entityId, status);
      await this.audit.log({ userId: user?.id ?? null, action: 'PAYMENT_REFUNDED', entity: 'payments', entityId: pay.id, newValue: { amount, status, reason: dto.reason, automatic: !user }, ...meta }, m);
      return { pay: { ...pay, status, refundedAmount: refunded } as Payment, amount };
    });
    if (res.pay.payerUserId) {
      await this.notifications.notify(res.pay.payerUserId, {
        type: 'PAYMENT_REFUNDED',
        category: 'PAYMENTS',
        title: 'تم استرداد مبلغ',
        body: `تم استرداد ${res.amount} ج.م من العملية ${res.pay.code}${res.pay.method === PaymentMethod.ONLINE ? ' إلى وسيلة الدفع خلال أيام عمل' : ''}. السبب: ${dto.reason}`,
        data: { paymentId: res.pay.id },
        force: true,
      });
    }
    const p = await this.payable(this.ds.manager, res.pay.entityType, res.pay.entityId);
    if (p) await this.emit(p);
    return this.get(user, paymentId).catch(() => ({ id: paymentId, status: res.pay.status }));
  }

  /**
   * A cancelled booking/order paid online is refunded in full automatically.
   * Cash paid at the desk is left to the provider (and can be recorded by finance).
   */
  async refundOnCancel(entityType: string, entityId: string, reason: string) {
    const rows: { id: string }[] = await this.ds.query(
      `SELECT id FROM payments WHERE entity_type = $1 AND entity_id = $2 AND method = 'ONLINE' AND status IN ('PAID','PARTIALLY_REFUNDED')`,
      [entityType, entityId],
    );
    for (const r of rows) {
      await this.refund(null, r.id, { reason }).catch((e) => this.logger.error(`Auto-refund on cancel failed (${r.id}): ${e.message}`));
    }
    // Abandon any checkout still open for it.
    await this.ds.query(`UPDATE payments SET status = 'FAILED', failure_reason = 'أُلغي الطلب' WHERE entity_type = $1 AND entity_id = $2 AND status = 'PENDING'`, [entityType, entityId]);
    return rows.length;
  }

  // ─────────────── Reading ───────────────

  private canSee(user: AuthUser | null, pay: { patientId: string | null; providerId: string; payerUserId: string | null }) {
    if (!user) return 'SYSTEM';
    if ((user.patientId && pay.patientId === user.patientId) || pay.payerUserId === user.id) return 'PAYER';
    if (user.permissions.has(P.FINANCE_READ)) return 'PLATFORM';
    if (user.adminProviderIds.includes(pay.providerId) && user.permissions.has(P.PAYMENTS_READ_PROVIDER)) return 'PROVIDER';
    return null;
  }

  async get(user: AuthUser | null, id: string) {
    const pay = await this.ds.getRepository(Payment).findOneBy({ id });
    if (!pay) throw new NotFoundException('عملية الدفع غير موجودة');
    const viewer = this.canSee(user, pay);
    if (!viewer) throw new NotFoundException('عملية الدفع غير موجودة');
    const [pr] = await this.ds.query(`SELECT name_ar, slug FROM providers WHERE id = $1`, [pay.providerId]);
    const refunds = await this.ds.query(`SELECT amount::float AS amount, reason, status, created_at FROM refunds WHERE payment_id = $1 ORDER BY created_at`, [id]);
    const [c] = viewer === 'PAYER' ? [] : await this.ds.query(`SELECT gross_amount::float AS gross, commission_amount::float AS commission, provider_amount::float AS provider, reversed_commission::float AS reversed_commission, reversed_provider_amount::float AS reversed_provider FROM commissions WHERE payment_id = $1`, [id]);
    const rec = await this.payable(this.ds.manager, pay.entityType, pay.entityId);
    return {
      id: pay.id,
      code: pay.code,
      entityType: pay.entityType,
      entityId: pay.entityId,
      entityCode: rec?.code,
      description: pay.description,
      method: pay.method,
      methodLabel: METHOD_AR[pay.method],
      status: pay.status,
      statusLabel: STATUS_AR[pay.status],
      amount: Number(pay.amount),
      refundedAmount: Number(pay.refundedAmount),
      currency: pay.currency,
      gateway: pay.gateway,
      collectedBy: pay.collectedBy,
      failureReason: pay.failureReason,
      paidAt: pay.paidAt,
      createdAt: pay.createdAt,
      provider: pr ? { id: pay.providerId, nameAr: pr.name_ar, slug: pr.slug } : null,
      refunds,
      commission: c ?? null,
      viewer,
    };
  }

  async list(user: AuthUser, scope: 'mine' | 'provider' | 'admin', q: PaymentsQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.split('?').join(`$${params.length}`));
    };
    if (scope === 'mine') {
      params.push(user.id, user.patientId);
      where.push(`(p.payer_user_id = $${params.length - 1} OR p.patient_id = $${params.length})`, `p.status <> 'PENDING'`, `p.entity_type <> 'SUBSCRIPTION'`);
    } else if (scope === 'provider') {
      if (!user.adminProviderIds.length) throw new ForbiddenException('هذا الحساب غير مرتبط بمقدم خدمة');
      add('p.provider_id = ANY(?::uuid[])', user.adminProviderIds);
      // Providers see settled money only; abandoned / declined attempts are noise for them.
      where.push(`p.entity_type <> 'SUBSCRIPTION'`, `p.status NOT IN ('PENDING', 'FAILED')`);
    } else if (q.providerId) add('p.provider_id = ?', q.providerId);
    if (q.status) add('p.status = ?', q.status);
    if (q.method) add('p.method = ?', q.method);
    if (q.entityType) add('p.entity_type = ?', q.entityType);
    if (q.collectedBy) add('p.collected_by = ?', q.collectedBy);
    if (q.from) add('p.created_at >= ?', DateTime.fromISO(q.from, { zone: this.tz }).startOf('day').toJSDate());
    if (q.to) add('p.created_at <= ?', DateTime.fromISO(q.to, { zone: this.tz }).endOf('day').toJSDate());
    if (q.search?.trim()) add('(p.code ILIKE ? OR pr.name_ar ILIKE ? OR u.full_name ILIKE ? OR p.description ILIKE ?)', `%${likeEscape(q.search.trim())}%`);
    const from = `FROM payments p JOIN providers pr ON pr.id = p.provider_id LEFT JOIN users u ON u.id = p.payer_user_id LEFT JOIN commissions c ON c.payment_id = p.id`;
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total ${from} ${cond}`, params);
    const { skip, take } = skipTake(q);
    const rows = await this.ds.query(
      `SELECT p.id, p.code, p.entity_type, p.entity_id, p.method, p.status, p.amount::float AS amount, p.refunded_amount::float AS refunded, p.collected_by, p.description, p.paid_at, p.created_at, p.gateway,
              pr.name_ar AS provider_name, pr.type AS provider_type, u.full_name AS payer_name,
              c.commission_amount::float AS commission, c.provider_amount::float AS provider_amount, c.reversed_commission::float AS reversed_commission, c.reversed_provider_amount::float AS reversed_provider
         ${from} ${cond} ORDER BY p.created_at DESC LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paginate(
      rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        entityType: r.entity_type,
        entityId: r.entity_id,
        method: r.method,
        status: r.status,
        amount: r.amount,
        refundedAmount: r.refunded,
        collectedBy: r.collected_by,
        description: r.description,
        paidAt: r.paid_at,
        createdAt: r.created_at,
        gateway: r.gateway,
        providerName: r.provider_name,
        providerType: r.provider_type,
        payerName: scope === 'mine' ? undefined : r.payer_name,
        commission: scope === 'mine' ? undefined : r.commission != null ? ROUND(r.commission - r.reversed_commission) : null,
        providerAmount: scope === 'mine' ? undefined : r.provider_amount != null ? ROUND(r.provider_amount - r.reversed_provider) : null,
      })),
      total,
      q,
    );
  }

  /** Payment state of one record, for the "pay online" button. */
  async forRecord(user: AuthUser, entityType: string, entityId: string) {
    const p = await this.payable(this.ds.manager, entityType, entityId);
    if (!p) throw new NotFoundException('غير موجود');
    const isPatient = user.patientId && p.patientId === user.patientId;
    const isProvider = user.providerIds.includes(p.providerId);
    if (!isPatient && !isProvider && !user.permissions.has(P.FINANCE_READ)) throw new NotFoundException('غير موجود');
    const payments = await this.ds.query(
      `SELECT id, code, method, status, amount::float AS amount, refunded_amount::float AS refunded_amount, paid_at, created_at, failure_reason
         FROM payments WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC`,
      [entityType, entityId],
    );
    return {
      amount: p.amount,
      paymentStatus: p.paymentStatus,
      canPayOnline: !!isPatient && p.payable && (await this.onlineAvailable()),
      payments: payments.map((x: any) => ({ ...x, methodLabel: METHOD_AR[x.method], statusLabel: STATUS_AR[x.status] })),
    };
  }

  // ─────────────── Receipt PDF ───────────────

  async receipt(user: AuthUser, id: string) {
    const d = await this.get(user, id);
    if (![PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED].includes(d.status)) throw new BadRequestException('الإيصال متاح للعمليات المدفوعة فقط');
    const [payer] = await this.ds.query(`SELECT u.full_name, u.phone FROM payments p LEFT JOIN users u ON u.id = p.payer_user_id WHERE p.id = $1`, [id]);
    const platform = await this.settings.get<string>('platform.name');
    const fmt = (v: Date | string | null) => (v ? DateTime.fromJSDate(new Date(v)).setZone(this.tz).setLocale('ar-EG').toFormat('d LLLL yyyy - h:mm a') : '—');
    const row = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`;
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${this.pdf.fonts()}
      body{font-family:'Plex Arabic',sans-serif;color:#13252B;font-size:12.5px;margin:0}
      .h{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0F4C5C;padding-bottom:10px}
      .h h1{margin:0;color:#0F4C5C;font-size:20px} .badge{padding:4px 12px;border-radius:999px;background:${d.status === 'PAID' ? '#E7F3EF' : '#FCF1DE'};color:${d.status === 'PAID' ? '#2E7D5B' : '#9a6a16'};font-weight:700}
      table{width:100%;border-collapse:collapse;margin-top:14px} td{padding:8px 6px;border-bottom:1px dashed #DCE5E4} td.k{color:#4A5F66;width:38%}
      .total{margin-top:14px;background:#F6F8F8;border:1px solid #DCE5E4;border-radius:10px;padding:12px;display:flex;justify-content:space-between;font-size:16px;font-weight:700}
      .f{margin-top:18px;color:#4A5F66;font-size:10.5px}</style></head><body>
      <div class="h"><div><h1>${esc(platform)}</h1><div>إيصال دفع</div></div><span class="badge">${esc(d.statusLabel)}</span></div>
      <table>
        ${row('رقم الإيصال', `<b dir="ltr">${esc(d.code)}</b>`)}
        ${row('التاريخ', esc(fmt(d.paidAt ?? d.createdAt)))}
        ${row('الخدمة', esc(`${d.description ?? ENTITY_LABEL[d.entityType]}${d.entityCode ? ` — ${d.entityCode}` : ''}`))}
        ${row('مقدم الخدمة', esc(d.provider?.nameAr ?? '—'))}
        ${row('الدافع', esc(payer?.full_name ?? '—') + (payer?.phone ? ` <span dir="ltr">${esc(payer.phone)}</span>` : ''))}
        ${row('طريقة الدفع', esc(d.methodLabel ?? d.method))}
        ${d.refundedAmount ? row('المسترد', `${d.refundedAmount} ج.م`) : ''}
      </table>
      <div class="total"><span>المبلغ</span><span>${d.amount} ج.م</span></div>
      <div class="f">إيصال إلكتروني صادر عبر ${esc(platform)} ولا يحتاج إلى توقيع.${d.collectedBy === 'PROVIDER' ? ' المبلغ سُدد مباشرة لمقدم الخدمة.' : ''}</div>
      </body></html>`;
    return { buffer: await this.pdf.render(html, { format: 'A5' }), fileName: `receipt-${d.code}.pdf` };
  }
}
