import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import {
  FileEntity,
  Payment,
  PaymentMethod,
  PaymentStatus,
  ProviderSubscription,
  SubscriptionInvoice,
  SubscriptionPlan,
} from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { likeEscape, paginate, skipTake } from '../../common/dto/pagination.dto';
import { humanCode } from '../../common/utils/codes';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { AuthUserLoader } from '../auth/auth-user.loader';
import { PaymentsService } from '../payments/payments.service';
import { CouponsService } from '../payments/coupons.service';
import { daysLeft, subscriptionAccess, subscriptionWindow } from '../payments/payments-logic';
import { ExtendDto, InvoicesQuery, ManualSubscriptionDto, PlanDto, SubscribeDto, SubscriptionsQuery } from './subscriptions.dto';

interface Meta {
  ip?: string;
  userAgent?: string | null;
}

const DAY = 86_400_000;
export const SUB_STATUS_AR: Record<string, string> = { TRIAL: 'فترة تجريبية', ACTIVE: 'نشط', GRACE: 'فترة سماح', EXPIRED: 'منتهي' };
export const INVOICE_STATUS_AR: Record<string, string> = {
  PENDING: 'بانتظار الدفع',
  AWAITING_REVIEW: 'قيد المراجعة',
  PAID: 'مدفوعة',
  REJECTED: 'مرفوضة',
  CANCELLED: 'ملغاة',
  FAILED: 'فشلت',
};
export const METHOD_LABEL: Record<string, string> = {
  ONLINE: 'بطاقة / دفع إلكتروني',
  INSTAPAY: 'إنستاباي',
  VODAFONE_CASH: 'فودافون كاش',
  BANK_TRANSFER: 'تحويل بنكي',
  CASH: 'نقدي',
  FREE: 'مجاني (كود خصم)',
};
const LEDGER_METHOD: Record<string, PaymentMethod> = {
  ONLINE: PaymentMethod.ONLINE,
  INSTAPAY: PaymentMethod.WALLET,
  VODAFONE_CASH: PaymentMethod.WALLET,
  BANK_TRANSFER: PaymentMethod.ONLINE,
  CASH: PaymentMethod.CASH,
};

/**
 * Monthly provider subscriptions. Doctors, labs, radiology centers and pharmacies keep
 * using the platform while (paid or trial) period + grace days has not passed; patients
 * are always free. Expired providers can still sign in, but only to renew — every other
 * endpoint answers 402 SUBSCRIPTION_REQUIRED and they disappear from public search.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private ds: DataSource,
    private audit: AuditService,
    private notifications: NotificationsService,
    private settings: SettingsService,
    private loader: AuthUserLoader,
    private payments: PaymentsService,
    private coupons: CouponsService,
  ) {}

  // ─────────────── State ───────────────

  async ensure(m: EntityManager, providerId: string): Promise<ProviderSubscription> {
    const existing = await m.findOne(ProviderSubscription, { where: { providerId } });
    if (existing) return existing;
    const trialDays = await this.settings.get<number>('subscriptions.trialDays');
    const end = new Date(Date.now() + trialDays * DAY);
    await m.query(
      `INSERT INTO provider_subscriptions (provider_id, status, trial_ends_at, current_period_end) VALUES ($1, 'TRIAL', $2, $2) ON CONFLICT (provider_id) DO NOTHING`,
      [providerId, end],
    );
    await m.query(`UPDATE providers SET subscription_ends_at = $2, subscription_active = true WHERE id = $1`, [providerId, end]);
    return (await m.findOne(ProviderSubscription, { where: { providerId } }))!;
  }

  private async state(sub: ProviderSubscription) {
    const grace = await this.settings.get<number>('subscriptions.graceDays');
    const access = subscriptionAccess(sub.currentPeriodEnd, grace);
    const status = access === 'ACTIVE' ? (sub.lastPaidAt ? 'ACTIVE' : 'TRIAL') : access;
    return {
      status,
      statusLabel: SUB_STATUS_AR[status],
      endsAt: sub.currentPeriodEnd,
      daysLeft: Math.max(0, daysLeft(sub.currentPeriodEnd)),
      graceEndsAt: new Date(sub.currentPeriodEnd.getTime() + grace * DAY),
      trialEndsAt: sub.trialEndsAt,
      lastPaidAt: sub.lastPaidAt,
      blocked: access === 'EXPIRED' && (await this.settings.get<boolean>('subscriptions.enabled')),
    };
  }

  private myProviderId(user: AuthUser) {
    const id = user.subscription?.providerId ?? user.providerIds[0];
    if (!id) throw new ForbiddenException('هذا الحساب غير مرتبط بمقدم خدمة');
    return id;
  }

  private canPay(user: AuthUser, providerId: string) {
    return user.adminProviderIds.includes(providerId) && user.permissions.has(P.PROVIDER_MANAGE_OWN);
  }

  async plans(type?: string) {
    const rows = await this.ds.getRepository(SubscriptionPlan).find({ where: { isActive: true, ...(type ? { providerType: type as any } : {}) }, order: { providerType: 'ASC', sortOrder: 'ASC', price: 'ASC' } });
    return rows.map((p) => ({ id: p.id, code: p.code, providerType: p.providerType, nameAr: p.nameAr, description: p.description, price: Number(p.price), durationDays: p.durationDays, features: p.features, isDefault: p.isDefault }));
  }

  async mine(user: AuthUser) {
    const providerId = this.myProviderId(user);
    const sub = await this.ensure(this.ds.manager, providerId);
    const [prov] = await this.ds.query(`SELECT id, type, name_ar, slug FROM providers WHERE id = $1`, [providerId]);
    const plan = sub.planId ? await this.ds.getRepository(SubscriptionPlan).findOneBy({ id: sub.planId }) : null;
    const invoices = await this.invoiceRows(`WHERE i.provider_id = $1`, [providerId], 20, 0);
    return {
      provider: { id: prov.id, type: prov.type, nameAr: prov.name_ar, slug: prov.slug },
      subscription: { ...(await this.state(sub)), plan: plan ? { id: plan.id, nameAr: plan.nameAr, price: Number(plan.price), durationDays: plan.durationDays } : null },
      plans: await this.plans(prov.type),
      invoices,
      canPay: this.canPay(user, providerId),
      payment: await this.payments.config(),
    };
  }

  // ─────────────── Buying ───────────────

  async subscribe(user: AuthUser, dto: SubscribeDto, meta: Meta = {}) {
    const providerId = this.myProviderId(user);
    if (!this.canPay(user, providerId)) throw new ForbiddenException('تجديد الاشتراك متاح لمدير الحساب فقط');
    const periods = dto.periods ?? 1;
    const manual = dto.method !== 'ONLINE';
    const res = await this.ds.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 77))`, [`sub:${providerId}`]);
      await this.ensure(m, providerId);
      const [prov] = await m.query(`SELECT type FROM providers WHERE id = $1`, [providerId]);
      const plan = await m.findOne(SubscriptionPlan, { where: { id: dto.planId, isActive: true } });
      if (!plan || plan.providerType !== prov.type) throw new BadRequestException('الباقة غير متاحة لنوع حسابك');
      const [waiting] = await m.query(`SELECT code FROM subscription_invoices WHERE provider_id = $1 AND status = 'AWAITING_REVIEW' LIMIT 1`, [providerId]);
      if (waiting) throw new ConflictException({ message: `لديك تحويل قيد المراجعة (${waiting.code}) — انتظر اعتماده`, code: 'INVOICE_UNDER_REVIEW' });
      // Abandoned online attempts give their coupon back.
      const [stale]: [{ id: string }[]] = await m.query(`UPDATE subscription_invoices SET status = 'CANCELLED' WHERE provider_id = $1 AND status = 'PENDING' RETURNING id`, [providerId]);
      for (const s of stale) await this.coupons.release(m, 'SUBSCRIPTION', s.id);
      if (manual) {
        if (!dto.proofFileId) throw new BadRequestException('ارفع صورة إيصال التحويل');
        const f = await m.findOne(FileEntity, { where: { id: dto.proofFileId, purpose: 'PAYMENT_PROOF' } });
        if (!f || f.uploadedById !== user.id) throw new BadRequestException('إيصال التحويل غير صالح');
      }
      const amount = Math.round(Number(plan.price) * periods * 100) / 100;
      const inv = await m.save(
        m.create(SubscriptionInvoice, {
          code: humanCode('SUB'),
          providerId,
          planId: plan.id,
          periods,
          amount,
          discount: 0,
          total: amount,
          status: 'PENDING',
          method: dto.method,
          proofFileId: dto.proofFileId ?? null,
          transferReference: dto.transferReference?.trim() || null,
          createdById: user.id,
        }),
      );
      let discount = 0;
      if (dto.couponCode?.trim()) {
        const r = await this.coupons.redeem(m, { code: dto.couponCode, entityType: 'SUBSCRIPTION', entityId: inv.id, providerId, amount, redeemerProviderId: providerId });
        discount = r.discount;
        await m.update(SubscriptionInvoice, inv.id, { couponId: r.couponId, discount, total: Math.round((amount - discount) * 100) / 100 });
      }
      const total = Math.round((amount - discount) * 100) / 100;
      await this.audit.log({ userId: user.id, action: 'SUBSCRIPTION_INVOICE_CREATED', entity: 'subscription_invoices', entityId: inv.id, newValue: { plan: plan.code, periods, amount, discount, method: dto.method }, ...meta }, m);
      if (total <= 0) {
        await m.update(SubscriptionInvoice, inv.id, { method: 'FREE' });
        await this.activateInvoice(m, inv.id, null, user.id);
        return { kind: 'ACTIVATED' as const, inv };
      }
      if (manual) {
        await m.update(SubscriptionInvoice, inv.id, { status: 'AWAITING_REVIEW' });
        return { kind: 'REVIEW' as const, inv };
      }
      const { payment, p, g } = await this.payments.checkoutSubscription(m, user, inv.id);
      return { kind: 'ONLINE' as const, inv, payment, p, g };
    });
    if (res.kind === 'ONLINE') {
      const session = await this.payments.openSession(res.g, res.payment, res.p, user, meta);
      return { status: 'REDIRECT', invoiceId: res.inv.id, redirectUrl: session.redirectUrl };
    }
    if (res.kind === 'REVIEW') {
      await this.notifyFinance(`تحويل اشتراك جديد بانتظار المراجعة (${res.inv.code}).`, res.inv.id);
      return { status: 'AWAITING_REVIEW', invoiceId: res.inv.id };
    }
    return { status: 'ACTIVATED', invoiceId: res.inv.id };
  }

  private async notifyFinance(body: string, invoiceId: string) {
    const admins: { id: string }[] = await this.ds.query(
      `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id AND p.code = 'subscriptions.manage' WHERE u.status = 'ACTIVE'`,
    );
    await this.notifications.notifyMany(admins.map((a) => a.id), { type: 'SUBSCRIPTION_REVIEW', category: 'PAYMENTS', title: 'مراجعة تحويل اشتراك', body, data: { invoiceId } });
  }

  /**
   * Marks an invoice paid and extends the provider's period (from its current end, or now
   * if it already lapsed). Runs inside the caller's transaction with the subscription row locked.
   */
  async activateInvoice(m: EntityManager, invoiceId: string, paymentId: string | null, byUserId: string | null) {
    const inv = await m.findOne(SubscriptionInvoice, { where: { id: invoiceId }, lock: { mode: 'pessimistic_write' } });
    if (!inv) throw new NotFoundException('الفاتورة غير موجودة');
    if (inv.status === 'PAID') return inv;
    const plan = inv.planId ? await m.findOne(SubscriptionPlan, { where: { id: inv.planId } }) : null;
    const sub = await m.findOne(ProviderSubscription, { where: { providerId: inv.providerId }, lock: { mode: 'pessimistic_write' } });
    const now = new Date();
    const w = subscriptionWindow(sub?.currentPeriodEnd ?? null, now, plan?.durationDays ?? 30, inv.periods);
    await m.update(SubscriptionInvoice, inv.id, { status: 'PAID', paidAt: now, paymentId, periodStart: w.start, periodEnd: w.end });
    await m.query(
      `UPDATE provider_subscriptions SET plan_id = $2, current_period_end = $3, status = 'ACTIVE', last_paid_at = $4, reminder_sent_at = NULL, expired_notified_at = NULL, updated_at = now() WHERE provider_id = $1`,
      [inv.providerId, inv.planId, w.end, now],
    );
    await m.query(`UPDATE providers SET subscription_active = true, subscription_ends_at = $2 WHERE id = $1`, [inv.providerId, w.end]);
    await this.audit.log({ userId: byUserId, action: 'SUBSCRIPTION_ACTIVATED', entity: 'provider_subscriptions', entityId: inv.providerId, newValue: { invoice: inv.code, until: w.end, paymentId } }, m);
    this.loader.invalidateAll();
    const [owner] = await m.query(`SELECT owner_user_id FROM providers WHERE id = $1`, [inv.providerId]);
    if (owner) {
      await this.notifications.notify(owner.owner_user_id, {
        type: 'SUBSCRIPTION_ACTIVATED',
        category: 'PAYMENTS',
        title: 'تم تفعيل الاشتراك',
        body: `تم تجديد اشتراكك${plan ? ` (${plan.nameAr})` : ''} حتى ${w.end.toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' })}. شكراً لك.`,
        data: { invoiceId: inv.id },
        force: true,
      });
    }
    return inv;
  }

  // ─────────────── Platform administration ───────────────

  private async invoiceRows(cond: string, params: unknown[], take: number, skip: number) {
    const rows = await this.ds.query(
      `SELECT i.id, i.code, i.status, i.method, i.periods, i.amount::float AS amount, i.discount::float AS discount, i.total::float AS total,
              i.proof_file_id, i.transfer_reference, i.period_start, i.period_end, i.review_note, i.paid_at, i.created_at, i.payment_id,
              pl.name_ar AS plan_name, pr.id AS provider_id, pr.name_ar AS provider_name, pr.type AS provider_type, c.code AS coupon_code
         FROM subscription_invoices i JOIN providers pr ON pr.id = i.provider_id LEFT JOIN subscription_plans pl ON pl.id = i.plan_id LEFT JOIN coupons c ON c.id = i.coupon_id
        ${cond} ORDER BY i.created_at DESC LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return rows.map((r: any) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      statusLabel: INVOICE_STATUS_AR[r.status],
      method: r.method,
      methodLabel: METHOD_LABEL[r.method] ?? r.method,
      periods: r.periods,
      amount: r.amount,
      discount: r.discount,
      total: r.total,
      couponCode: r.coupon_code,
      proofFileId: r.proof_file_id,
      transferReference: r.transfer_reference,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      reviewNote: r.review_note,
      paidAt: r.paid_at,
      paymentId: r.payment_id,
      createdAt: r.created_at,
      planName: r.plan_name,
      provider: { id: r.provider_id, nameAr: r.provider_name, type: r.provider_type },
    }));
  }

  async invoices(q: InvoicesQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) {
      params.push(q.status);
      where.push(`i.status = $${params.length}`);
    }
    if (q.providerId) {
      params.push(q.providerId);
      where.push(`i.provider_id = $${params.length}`);
    }
    if (q.search?.trim()) {
      params.push(`%${likeEscape(q.search.trim())}%`);
      where.push(`(i.code ILIKE $${params.length} OR pr.name_ar ILIKE $${params.length} OR i.transfer_reference ILIKE $${params.length})`);
    }
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM subscription_invoices i JOIN providers pr ON pr.id = i.provider_id ${cond}`, params);
    const { skip, take } = skipTake(q);
    return paginate(await this.invoiceRows(cond, params, take, skip), total, q);
  }

  async list(q: SubscriptionsQuery) {
    const grace = await this.settings.get<number>('subscriptions.graceDays');
    // $1 (grace days) is always referenced so the count query binds the same params.
    const where: string[] = ['$1::int >= 0'];
    const params: unknown[] = [grace];
    const statusSql = `CASE WHEN now() <= s.current_period_end THEN (CASE WHEN s.last_paid_at IS NULL THEN 'TRIAL' ELSE 'ACTIVE' END)
                            WHEN now() <= s.current_period_end + make_interval(days => $1::int) THEN 'GRACE' ELSE 'EXPIRED' END`;
    if (q.status) {
      params.push(q.status);
      where.push(`${statusSql} = $${params.length}`);
    }
    if (q.type) {
      params.push(q.type);
      where.push(`pr.type = $${params.length}`);
    }
    if (q.expiringDays) {
      params.push(q.expiringDays);
      where.push(`s.current_period_end BETWEEN now() AND now() + make_interval(days => $${params.length}::int)`);
    }
    if (q.search?.trim()) {
      params.push(`%${likeEscape(q.search.trim())}%`);
      where.push(`(pr.name_ar ILIKE $${params.length} OR u.phone ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`);
    }
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM provider_subscriptions s JOIN providers pr ON pr.id = s.provider_id JOIN users u ON u.id = pr.owner_user_id LEFT JOIN subscription_plans pl ON pl.id = s.plan_id`;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total ${from} ${cond}`, params);
    const { skip, take } = skipTake(q);
    const rows = await this.ds.query(
      `SELECT s.provider_id, s.current_period_end, s.trial_ends_at, s.last_paid_at, ${statusSql} AS status, pr.name_ar, pr.type, pr.slug, pr.verification_status,
              u.full_name AS owner_name, u.phone AS owner_phone, pl.name_ar AS plan_name, pl.price::float AS plan_price,
              (SELECT coalesce(sum(total), 0) FROM subscription_invoices i WHERE i.provider_id = s.provider_id AND i.status = 'PAID')::float AS paid_total
         ${from} ${cond} ORDER BY s.current_period_end ASC LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paginate(
      rows.map((r: any) => ({
        providerId: r.provider_id,
        nameAr: r.name_ar,
        type: r.type,
        slug: r.slug,
        verificationStatus: r.verification_status,
        ownerName: r.owner_name,
        ownerPhone: r.owner_phone,
        status: r.status,
        statusLabel: SUB_STATUS_AR[r.status],
        endsAt: r.current_period_end,
        daysLeft: daysLeft(new Date(r.current_period_end)),
        trialEndsAt: r.trial_ends_at,
        lastPaidAt: r.last_paid_at,
        planName: r.plan_name,
        planPrice: r.plan_price,
        paidTotal: r.paid_total,
      })),
      total,
      q,
    );
  }

  /** Transfer receipt checked → money recorded in the ledger and the period extended. */
  async approve(user: AuthUser, id: string, note: string | undefined, meta: Meta = {}) {
    await this.ds.transaction(async (m) => {
      const inv = await m.findOne(SubscriptionInvoice, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!inv) throw new NotFoundException('الفاتورة غير موجودة');
      if (inv.status !== 'AWAITING_REVIEW') throw new BadRequestException('الفاتورة ليست قيد المراجعة');
      const pay = await this.ledger(m, inv, user.id);
      await m.update(SubscriptionInvoice, id, { reviewedById: user.id, reviewNote: note?.trim() || null });
      await this.activateInvoice(m, id, pay.id, user.id);
      await this.audit.log({ userId: user.id, action: 'SUBSCRIPTION_TRANSFER_APPROVED', entity: 'subscription_invoices', entityId: id, newValue: { total: inv.total, note }, ...meta }, m);
    });
    return { ok: true };
  }

  private async ledger(m: EntityManager, inv: SubscriptionInvoice, byUserId: string | null) {
    return m.save(
      m.create(Payment, {
        code: humanCode('PAY'),
        patientId: null,
        providerId: inv.providerId,
        entityType: 'SUBSCRIPTION',
        entityId: inv.id,
        method: LEDGER_METHOD[inv.method] ?? PaymentMethod.CASH,
        status: PaymentStatus.PAID,
        amount: inv.total,
        currency: 'EGP',
        gateway: null,
        gatewayReference: inv.transferReference,
        paidAt: new Date(),
        payerUserId: inv.createdById,
        description: `اشتراك — ${METHOD_LABEL[inv.method] ?? inv.method}`,
        collectedBy: 'PLATFORM',
        recordedById: byUserId,
      }),
    );
  }

  async reject(user: AuthUser, id: string, note: string | undefined, meta: Meta = {}) {
    if (!note?.trim()) throw new BadRequestException('اكتب سبب الرفض لمقدم الخدمة');
    const inv = await this.ds.transaction(async (m) => {
      const inv = await m.findOne(SubscriptionInvoice, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!inv) throw new NotFoundException('الفاتورة غير موجودة');
      if (inv.status !== 'AWAITING_REVIEW') throw new BadRequestException('الفاتورة ليست قيد المراجعة');
      await m.update(SubscriptionInvoice, id, { status: 'REJECTED', reviewedById: user.id, reviewNote: note.trim() });
      await this.coupons.release(m, 'SUBSCRIPTION', id);
      await this.audit.log({ userId: user.id, action: 'SUBSCRIPTION_TRANSFER_REJECTED', entity: 'subscription_invoices', entityId: id, newValue: { note }, ...meta }, m);
      return inv;
    });
    const [owner] = await this.ds.query(`SELECT owner_user_id FROM providers WHERE id = $1`, [inv.providerId]);
    await this.notifications.notify(owner.owner_user_id, { type: 'SUBSCRIPTION_REJECTED', category: 'PAYMENTS', title: 'لم يتم قبول التحويل', body: `فاتورة ${inv.code}: ${note}`, data: { invoiceId: id }, force: true });
    return { ok: true };
  }

  /** Cash at the office, or a transfer the admin verified without a receipt upload. */
  async recordManual(user: AuthUser, providerId: string, dto: ManualSubscriptionDto, meta: Meta = {}) {
    await this.ds.transaction(async (m) => {
      await this.ensure(m, providerId);
      const [prov] = await m.query(`SELECT type FROM providers WHERE id = $1`, [providerId]);
      if (!prov) throw new NotFoundException('مقدم الخدمة غير موجود');
      const plan = await m.findOne(SubscriptionPlan, { where: { id: dto.planId } });
      if (!plan || plan.providerType !== prov.type) throw new BadRequestException('الباقة لا تناسب نوع مقدم الخدمة');
      const periods = dto.periods ?? 1;
      const total = Math.round(Number(plan.price) * periods * 100) / 100;
      const inv = await m.save(
        m.create(SubscriptionInvoice, {
          code: humanCode('SUB'),
          providerId,
          planId: plan.id,
          periods,
          amount: total,
          discount: 0,
          total,
          status: 'AWAITING_REVIEW',
          method: dto.method,
          transferReference: dto.reference ?? null,
          reviewedById: user.id,
          reviewNote: dto.note ?? null,
          createdById: user.id,
        }),
      );
      const pay = await this.ledger(m, inv, user.id);
      await this.activateInvoice(m, inv.id, pay.id, user.id);
      await this.audit.log({ userId: user.id, action: 'SUBSCRIPTION_RECORDED_BY_ADMIN', entity: 'subscription_invoices', entityId: inv.id, newValue: { providerId, plan: plan.code, periods, method: dto.method }, ...meta }, m);
    });
    return { ok: true };
  }

  /** Goodwill days (outage compensation, onboarding…) — audited, no money involved. */
  async extend(user: AuthUser, providerId: string, dto: ExtendDto, meta: Meta = {}) {
    await this.ds.transaction(async (m) => {
      const sub = await this.ensure(m, providerId);
      await m.query(`SELECT 1 FROM provider_subscriptions WHERE provider_id = $1 FOR UPDATE`, [providerId]);
      const base = sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
      const end = new Date(base.getTime() + dto.days * DAY);
      await m.query(`UPDATE provider_subscriptions SET current_period_end = $2, expired_notified_at = NULL, reminder_sent_at = NULL, updated_at = now() WHERE provider_id = $1`, [providerId, end]);
      await m.query(`UPDATE providers SET subscription_active = true, subscription_ends_at = $2 WHERE id = $1`, [providerId, end]);
      await this.audit.log({ userId: user.id, action: 'SUBSCRIPTION_EXTENDED', entity: 'provider_subscriptions', entityId: providerId, oldValue: { end: sub.currentPeriodEnd }, newValue: { end, days: dto.days, note: dto.note }, ...meta }, m);
    });
    this.loader.invalidateAll();
    await this.sync();
    return { ok: true };
  }

  async allPlans() {
    const rows = await this.ds.query(
      `SELECT p.*, p.price::float AS price, (SELECT count(*) FROM provider_subscriptions s WHERE s.plan_id = p.id)::int AS subscribers FROM subscription_plans p ORDER BY p.provider_type, p.sort_order, p.price`,
    );
    return rows.map((r: any) => ({ id: r.id, code: r.code, providerType: r.provider_type, nameAr: r.name_ar, description: r.description, price: r.price, durationDays: r.duration_days, features: r.features, isDefault: r.is_default, isActive: r.is_active, sortOrder: r.sort_order, subscribers: r.subscribers }));
  }

  async savePlan(user: AuthUser, dto: PlanDto, id?: string) {
    const repo = this.ds.getRepository(SubscriptionPlan);
    const dup = await repo.findOne({ where: { code: dto.code } });
    if (dup && dup.id !== id) throw new ConflictException('كود الباقة مستخدم');
    const data = { ...dto, description: dto.description?.trim() || null, durationDays: dto.durationDays ?? 30, features: dto.features ?? [], isActive: dto.isActive ?? true, sortOrder: dto.sortOrder ?? 0, isDefault: dto.isDefault ?? false };
    return this.ds.transaction(async (m) => {
      if (data.isDefault) await m.query(`UPDATE subscription_plans SET is_default = false WHERE provider_type = $1 AND ($2::uuid IS NULL OR id <> $2)`, [dto.providerType, id ?? null]);
      let planId = id;
      if (id) {
        if (!(await m.findOneBy(SubscriptionPlan, { id }))) throw new NotFoundException('الباقة غير موجودة');
        await m.update(SubscriptionPlan, id, data);
      } else planId = (await m.save(repo.create(data))).id;
      await this.audit.log({ userId: user.id, action: id ? 'PLAN_UPDATED' : 'PLAN_CREATED', entity: 'subscription_plans', entityId: planId, newValue: data }, m);
      return { id: planId };
    });
  }

  // ─────────────── Background sync, reminders, expiry ───────────────

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'subscriptions-sync' })
  async cron() {
    await this.sync().catch((e) => this.logger.error(`Subscription sync failed: ${e.message}`));
  }

  /** Keeps statuses and the public-visibility flag in step with the dates; sends reminders once. */
  async sync() {
    const enabled = await this.settings.get<boolean>('subscriptions.enabled');
    const grace = await this.settings.get<number>('subscriptions.graceDays');
    const remind = await this.settings.get<number>('subscriptions.reminderDays');
    const trialDays = await this.settings.get<number>('subscriptions.trialDays');
    // Providers created outside the normal sign-up path get their trial now.
    await this.ds.query(
      `INSERT INTO provider_subscriptions (provider_id, status, trial_ends_at, current_period_end)
       SELECT p.id, 'TRIAL', p.created_at + make_interval(days => $1::int), GREATEST(p.created_at + make_interval(days => $1::int), now() + interval '1 day')
         FROM providers p WHERE NOT EXISTS (SELECT 1 FROM provider_subscriptions s WHERE s.provider_id = p.id)`,
      [trialDays],
    );
    await this.ds.query(
      `UPDATE provider_subscriptions s SET status = CASE
          WHEN now() <= s.current_period_end THEN (CASE WHEN s.last_paid_at IS NULL THEN 'TRIAL' ELSE 'ACTIVE' END)
          WHEN now() <= s.current_period_end + make_interval(days => $1::int) THEN 'GRACE' ELSE 'EXPIRED' END`,
      [grace],
    );
    const [changed] = await this.ds.query(
      `UPDATE providers p SET subscription_ends_at = s.current_period_end, subscription_active = ($1::boolean = false OR s.status <> 'EXPIRED')
         FROM provider_subscriptions s
        WHERE s.provider_id = p.id AND (p.subscription_active IS DISTINCT FROM ($1::boolean = false OR s.status <> 'EXPIRED') OR p.subscription_ends_at IS DISTINCT FROM s.current_period_end)
        RETURNING p.id`,
      [enabled],
    );
    if (changed?.length) this.loader.invalidateAll();
    if (!enabled) return;
    const soon: { provider_id: string; owner_user_id: string; current_period_end: Date; status: string }[] = await this.ds.query(
      `SELECT s.provider_id, p.owner_user_id, s.current_period_end, s.status FROM provider_subscriptions s JOIN providers p ON p.id = s.provider_id
        WHERE s.reminder_sent_at IS NULL AND s.status IN ('TRIAL','ACTIVE') AND s.current_period_end <= now() + make_interval(days => $1::int)`,
      [remind],
    );
    for (const s of soon) {
      const d = Math.max(0, daysLeft(new Date(s.current_period_end)));
      await this.notifications.notify(s.owner_user_id, {
        type: 'SUBSCRIPTION_EXPIRING',
        category: 'PAYMENTS',
        title: s.status === 'TRIAL' ? 'الفترة التجريبية قاربت على الانتهاء' : 'اشتراكك قارب على الانتهاء',
        body: `باقي ${d} يوم على انتهاء ${s.status === 'TRIAL' ? 'الفترة التجريبية' : 'الاشتراك'}. جدّد الآن حتى لا يتوقف حسابك وحجوزاتك.`,
        data: { subscription: true },
        force: true,
      });
      await this.ds.query(`UPDATE provider_subscriptions SET reminder_sent_at = now() WHERE provider_id = $1`, [s.provider_id]);
    }
    const expired: { provider_id: string; owner_user_id: string }[] = await this.ds.query(
      `SELECT s.provider_id, p.owner_user_id FROM provider_subscriptions s JOIN providers p ON p.id = s.provider_id WHERE s.status = 'EXPIRED' AND s.expired_notified_at IS NULL`,
    );
    for (const s of expired) {
      await this.notifications.notify(s.owner_user_id, {
        type: 'SUBSCRIPTION_EXPIRED',
        category: 'PAYMENTS',
        title: 'تم إيقاف الحساب لانتهاء الاشتراك',
        body: 'انتهى الاشتراك وفترة السماح، ولم يعد حسابك ظاهراً للمرضى. ادفع الاشتراك لإعادة التفعيل فوراً.',
        data: { subscription: true },
        force: true,
      });
      await this.ds.query(`UPDATE provider_subscriptions SET expired_notified_at = now() WHERE provider_id = $1`, [s.provider_id]);
    }
  }
}
