import { CouponsService } from '../payments/coupons.service';
import { PaymentsService } from '../payments/payments.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { DataSource, EntityManager } from 'typeorm';
import {
  FileEntity,
  FulfillmentType,
  Patient,
  PaymentMethod,
  PaymentStatus,
  Pharmacy,
  PharmacyOrder,
  PharmacyOrderItem,
  PharmacyOrderStatus as S,
  PharmacyOrderStatusHistory,
  Prescription,
  ProviderBranch,
} from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { likeEscape, paginate, skipTake } from '../../common/dto/pagination.dto';
import { humanCode } from '../../common/utils/codes';
import { normalizePhone } from '../../common/utils/phone';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { SettingsService } from '../settings/settings.service';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';
import { PharmacyCatalogService } from './pharmacy-catalog.service';
import { CartItemDto, ConfirmOrderDto, PharmacyOrdersQuery, PharmacyStatusDto, PlaceOrderDto } from './pharmacy.dto';
import {
  OPEN_STATUSES,
  PATIENT_CANCELLABLE,
  PHARMACY_CANCELLABLE,
  PH_STATUS_AR,
  RX_STATE_AR,
  deliveryFeeFor,
  medicineLabel,
  nextStatuses,
  orderTotals,
  uncoveredRxItems,
} from './pharmacy-logic';

export type PhViewer = 'PATIENT' | 'PHARMACY' | 'PLATFORM';
interface Meta {
  ip?: string;
  userAgent?: string | null;
}
const PHARMACY_PERMS = [P.PHARMACY_ORDERS_MANAGE, P.PHARMACY_CATALOG_MANAGE, P.PRESCRIPTIONS_VERIFY];
const money = (n: number) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ج.م`;

interface PricedLine {
  medicineId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  requiresPrescription: boolean;
}

@Injectable()
export class PharmacyOrdersService {
  readonly tz: string;

  constructor(
    private ds: DataSource,
    config: ConfigService,
    private catalog: PharmacyCatalogService,
    private prescriptions: PrescriptionsService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private gateway: NotificationsGateway,
    private settings: SettingsService,
    private coupons: CouponsService,
    private payments: PaymentsService,
  ) {
    this.tz = config.get<string>('timezone')!;
  }

  async teamUserIds(providerId: string, m: EntityManager = this.ds.manager): Promise<string[]> {
    const rows: { id: string }[] = await m.query(
      `SELECT owner_user_id AS id FROM providers WHERE id = $1 UNION SELECT user_id FROM provider_staff WHERE provider_id = $1 AND is_active`,
      [providerId],
    );
    return rows.map((r) => r.id);
  }

  async broadcast(order: { id: string; status: S; patientId: string; pharmacyId: string }) {
    const [row] = await this.ds.query(`SELECT pa.user_id, ph.provider_id FROM patients pa, pharmacies ph WHERE pa.id = $1 AND ph.id = $2`, [order.patientId, order.pharmacyId]);
    if (!row) return;
    const team = await this.teamUserIds(row.provider_id);
    this.gateway.emitToUsers([...team, row.user_id], 'pharmacy:order', { id: order.id, status: order.status });
  }

  async history(m: EntityManager, orderId: string, from: S | null, to: S, by: string | null, note?: string | null) {
    await m.insert(PharmacyOrderStatusHistory, { orderId, fromStatus: from, toStatus: to, changedById: by, note: note ?? null });
  }

  async notifyPatient(order: { id: string; patientId: string }, title: string, body: string, type: string, force = false) {
    const [row] = await this.ds.query(`SELECT user_id FROM patients WHERE id = $1`, [order.patientId]);
    if (row) await this.notifications.notify(row.user_id, { type, category: 'PHARMACY', title, body, data: { pharmacyOrderId: order.id }, force });
  }

  /** Merge duplicate lines, then price every line from THIS pharmacy's inventory (never from the client). */
  private async price(m: EntityManager, pharmacyId: string, cart: CartItemDto[], checkStock: boolean): Promise<PricedLine[]> {
    const merged = new Map<string, number>();
    for (const c of cart) merged.set(c.medicineId, (merged.get(c.medicineId) ?? 0) + c.quantity);
    if (!merged.size) return [];
    const rows = await m.query(
      `SELECT pi.medicine_id, pi.price::float AS price, pi.in_stock, pi.quantity, m.name_en, m.strength, m.form, m.requires_prescription, m.is_active
         FROM pharmacy_inventory pi JOIN medicines m ON m.id = pi.medicine_id WHERE pi.pharmacy_id = $1 AND pi.medicine_id = ANY($2::uuid[])`,
      [pharmacyId, [...merged.keys()]],
    );
    const byId = new Map(rows.map((r: any) => [r.medicine_id, r]));
    const missing: string[] = [];
    const lines: PricedLine[] = [];
    for (const [id, qty] of merged) {
      const r: any = byId.get(id);
      if (!r || !r.is_active) {
        missing.push(id);
        continue;
      }
      const name = medicineLabel({ nameEn: r.name_en, strength: r.strength, form: r.form });
      if (qty > 50) throw new BadRequestException(`الكمية المطلوبة من ${name} كبيرة`);
      if (checkStock && (!r.in_stock || (r.quantity != null && r.quantity < qty))) {
        throw new ConflictException({ message: `${name}: الكمية المتاحة غير كافية`, code: 'OUT_OF_STOCK', medicineId: id, available: r.in_stock ? r.quantity : 0 });
      }
      lines.push({ medicineId: id, name, quantity: qty, unitPrice: r.price, requiresPrescription: r.requires_prescription });
    }
    if (missing.length) throw new BadRequestException({ message: 'بعض الأصناف غير متوفرة في هذه الصيدلية', code: 'NOT_LISTED', medicineIds: missing });
    return lines;
  }

  private async rxForPatient(m: EntityManager, prescriptionId: string, patientId: string, ignoreOrderId?: string) {
    const rx = await m.findOne(Prescription, { where: { id: prescriptionId }, relations: { items: true } });
    if (!rx || rx.patientId !== patientId) throw new BadRequestException('الروشتة غير صحيحة');
    const st = this.prescriptions.state(rx);
    if (st !== 'ACTIVE') throw new ConflictException({ message: `لا يمكن طلب الروشتة: ${RX_STATE_AR[st]}`, code: `RX_${st}` });
    const [busy] = await m.query(
      `SELECT code FROM pharmacy_orders WHERE prescription_id = $1 AND status = ANY($2::pharmacy_order_status[]) AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1`,
      [rx.id, OPEN_STATUSES, ignoreOrderId ?? null],
    );
    if (busy) throw new ConflictException({ message: `الروشتة مرتبطة بطلب آخر قيد التنفيذ (${busy.code})`, code: 'RX_IN_ORDER' });
    return rx;
  }

  private assertCovered(lines: PricedLine[], rx: Prescription | null, hasUpload: boolean) {
    const prescribed = new Set((rx?.items ?? []).map((i) => i.medicineId).filter(Boolean) as string[]);
    const uncovered = uncoveredRxItems(lines, prescribed, hasUpload);
    if (uncovered.length) {
      throw new BadRequestException({ message: `هذه الأصناف تحتاج روشتة: ${uncovered.join('، ')}. ارفع صورة الروشتة أو اختر روشتة إلكترونية تتضمنها.`, code: 'RX_REQUIRED', items: uncovered });
    }
  }

  // ─────────────── Patient: placing an order ───────────────

  async place(user: AuthUser, dto: PlaceOrderDto, meta: Meta = {}) {
    const patientId = user.patientId;
    if (!patientId) throw new ForbiddenException('يجب أن يكون لديك ملف مريض للطلب من الصيدليات');
    if (!dto.items.length && !dto.prescriptionId && !dto.prescriptionFileId) throw new BadRequestException('أضف أصنافاً للسلة أو أرفق روشتة');
    const maxOpen = await this.settings.get<number>('pharmacy.maxOpenOrdersPerPatient');

    const order = await this.ds.transaction(async (m) => {
      const ph = await this.catalog.publicPharmacy(dto.pharmacy, m);
      const provider = ph.provider!;
      if ((await this.teamUserIds(provider.id, m)).includes(user.id)) throw new BadRequestException('لا يمكنك الطلب من الصيدلية التي تعمل بها');
      // Serialise one patient's orders so the open-orders limit cannot be raced.
      await m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 61))`, [`pho:${patientId}`]);
      const patient = await m.findOne(Patient, { where: { id: patientId }, relations: { user: true } });
      if (!patient || patient.user?.status !== 'ACTIVE') throw new BadRequestException('حساب المريض غير مفعل');
      const [{ open }] = await m.query(`SELECT count(*)::int AS open FROM pharmacy_orders WHERE patient_id = $1 AND status = ANY($2::pharmacy_order_status[])`, [patientId, OPEN_STATUSES]);
      if (open >= maxOpen) throw new ConflictException({ message: `لديك ${open} طلبات صيدلية قيد التنفيذ. انتظر استلامها أو ألغِ أحدها.`, code: 'TOO_MANY_OPEN' });

      const rx = dto.prescriptionId ? await this.rxForPatient(m, dto.prescriptionId, patientId) : null;
      if (dto.prescriptionFileId) {
        const f = await m.findOne(FileEntity, { where: { id: dto.prescriptionFileId, purpose: 'PRESCRIPTION_UPLOAD' } });
        if (!f || f.uploadedById !== user.id) throw new BadRequestException('صورة الروشتة غير صالحة');
      }
      const lines = await this.price(m, ph.id, dto.items, true);
      this.assertCovered(lines, rx, !!dto.prescriptionFileId);

      let branchId: string | null = null;
      let address: string | null = null;
      if (dto.fulfillment === FulfillmentType.PICKUP) {
        const branches = await m.find(ProviderBranch, { where: { providerId: provider.id, isActive: true }, order: { createdAt: 'ASC' } });
        const b = dto.branchId ? branches.find((x) => x.id === dto.branchId) : branches[0];
        if (!b) throw new BadRequestException('فرع الاستلام غير متاح');
        branchId = b.id;
      } else {
        address = dto.deliveryAddress?.trim() || null;
        if (!address) throw new BadRequestException('اكتب عنوان التوصيل بالتفصيل');
      }
      let totals = { subtotal: 0, deliveryFee: 0, total: 0 };
      try {
        totals = lines.length
          ? orderTotals(lines, ph, dto.fulfillment)
          : { subtotal: 0, deliveryFee: deliveryFeeFor({ ...ph, minOrderForDelivery: 0 }, dto.fulfillment, 0), total: 0 };
        if (!lines.length) totals.total = totals.deliveryFee;
      } catch (e: any) {
        if (e.message === 'NO_DELIVERY') throw new BadRequestException({ message: 'هذه الصيدلية لا توفر التوصيل حالياً — اختر الاستلام من الفرع', code: 'NO_DELIVERY' });
        if (e.message === 'BELOW_MINIMUM') throw new BadRequestException({ message: `الحد الأدنى لطلبات التوصيل ${money(ph.minOrderForDelivery)}`, code: 'BELOW_MINIMUM' });
        throw e;
      }
      const phone = dto.contactPhone ? normalizePhone(dto.contactPhone) : patient.user!.phone;
      if (dto.contactPhone && !phone) throw new BadRequestException('رقم التواصل غير صحيح');

      const o = await m.save(
        m.create(PharmacyOrder, {
          code: humanCode('PH'),
          pharmacyId: ph.id,
          patientId,
          branchId,
          prescriptionId: rx?.id ?? null,
          prescriptionFileId: dto.prescriptionFileId ?? null,
          fulfillment: dto.fulfillment,
          deliveryAddress: address,
          status: S.PENDING,
          ...totals,
          paymentMethod: PaymentMethod.CASH,
          contactPhone: phone,
          notes: dto.notes?.trim() || null,
          createdById: user.id,
        }),
      );
      if (lines.length) {
        await m.insert(
          PharmacyOrderItem,
          lines.map((l) => ({ orderId: o.id, medicineId: l.medicineId, medicineName: l.name, quantity: l.quantity, unitPrice: l.unitPrice })),
        );
      }
      if (dto.couponCode?.trim()) {
        if (!lines.length) throw new BadRequestException({ message: 'كود الخصم يُطبق على الطلبات المسعّرة — أضف الأصناف أو استخدمه في طلب لاحق', code: 'COUPON_NOT_APPLICABLE' });
        // Discount on the medicines; delivery is charged in full.
        const c = await this.coupons.redeem(m, { code: dto.couponCode, entityType: 'PHARMACY_ORDER', entityId: o.id, providerId: provider.id, amount: totals.subtotal, patientId });
        o.discount = c.discount;
        o.total = Math.round((totals.subtotal + totals.deliveryFee - c.discount) * 100) / 100;
        await m.update(PharmacyOrder, o.id, { discount: c.discount, total: o.total, couponId: c.couponId });
      }
      await this.history(m, o.id, null, S.PENDING, user.id, lines.length ? null : 'طلب تسعير روشتة');
      await this.audit.log(
        { userId: user.id, action: 'PHARMACY_ORDER_PLACED', entity: 'pharmacy_orders', entityId: o.id, newValue: { code: o.code, pharmacyId: ph.id, items: lines.length, total: totals.total, fulfillment: dto.fulfillment, prescriptionId: rx?.id ?? null, upload: !!dto.prescriptionFileId }, ...meta },
        m,
      );
      return { o, providerId: provider.id, quote: !lines.length };
    });

    await this.notifications.notifyMany(await this.teamUserIds(order.providerId), {
      type: 'PHARMACY_ORDER_NEW',
      category: 'PHARMACY',
      title: order.quote ? 'طلب تسعير روشتة جديد' : 'طلب صيدلية جديد',
      body: `${order.o.code} — ${order.o.fulfillment === FulfillmentType.DELIVERY ? 'توصيل' : 'استلام من الفرع'}${order.quote ? '' : ` — ${money(order.o.total)}`}`,
      data: { pharmacyOrderId: order.o.id },
    });
    await this.broadcast(order.o);
    return this.get(user, order.o.id);
  }

  // ─────────────── Access ───────────────

  async viewerFor(user: AuthUser, o: { patientId: string; pharmacy?: { providerId: string } | null }): Promise<PhViewer> {
    if (user.patientId && o.patientId === user.patientId) return 'PATIENT';
    if (o.pharmacy && user.providerIds.includes(o.pharmacy.providerId) && PHARMACY_PERMS.some((p) => user.permissions.has(p))) return 'PHARMACY';
    if (user.permissions.has(P.PHARMACY_ORDERS_READ_ANY)) return 'PLATFORM';
    throw new NotFoundException('الطلب غير موجود');
  }

  async load(id: string, m: EntityManager = this.ds.manager) {
    const o = await m.findOne(PharmacyOrder, { where: { id }, relations: { pharmacy: { provider: true }, branch: true, patient: { user: true }, items: true } });
    if (!o) throw new NotFoundException('الطلب غير موجود');
    return o;
  }

  async forPharmacy(user: AuthUser, id: string, m: EntityManager) {
    const o = await m.findOne(PharmacyOrder, { where: { id }, relations: { pharmacy: true }, lock: { mode: 'pessimistic_write', tables: ['pharmacy_orders'] } });
    if (!o || !user.providerIds.includes(o.pharmacy!.providerId)) throw new NotFoundException('الطلب غير موجود');
    if (!user.permissions.has(P.PHARMACY_ORDERS_MANAGE)) throw new ForbiddenException('لا تملك صلاحية تنفيذ هذا الإجراء');
    return o;
  }

  capabilities(user: AuthUser, viewer: PhViewer, o: PharmacyOrder) {
    const manage = viewer === 'PHARMACY' && user.permissions.has(P.PHARMACY_ORDERS_MANAGE);
    return {
      confirm: manage && o.status === S.PENDING,
      transitions: manage ? nextStatuses(o.status, o.fulfillment) : [],
      cancel: (viewer === 'PATIENT' && PATIENT_CANCELLABLE.includes(o.status)) || (manage && PHARMACY_CANCELLABLE.includes(o.status)),
      viewPrescription: viewer !== 'PLATFORM' && (!!o.prescriptionId || !!o.prescriptionFileId),
      chat: viewer !== 'PLATFORM',
      reorder: viewer === 'PATIENT' && [S.DELIVERED, S.CANCELLED].includes(o.status) && !o.prescriptionId,
    };
  }

  async get(user: AuthUser, id: string) {
    const o = await this.load(id);
    const viewer = await this.viewerFor(user, o);
    const p = o.pharmacy!.provider!;
    const history = await this.ds.query(
      `SELECT h.from_status, h.to_status, h.note, h.created_at, u.full_name AS by_name
         FROM pharmacy_order_status_history h LEFT JOIN users u ON u.id = h.changed_by_id WHERE h.order_id = $1 ORDER BY h.created_at ASC`,
      [id],
    );
    const base = {
      id: o.id,
      code: o.code,
      status: o.status,
      statusLabel: PH_STATUS_AR[o.status],
      fulfillment: o.fulfillment,
      subtotal: Number(o.subtotal),
      deliveryFee: Number(o.deliveryFee),
      discount: Number(o.discount),
      total: Number(o.total),
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      paidAt: o.paidAt,
      createdAt: o.createdAt,
      confirmedAt: o.confirmedAt,
      readyAt: o.readyAt,
      outForDeliveryAt: o.outForDeliveryAt,
      deliveredAt: o.deliveredAt,
      cancelledAt: o.cancelledAt,
      cancelReason: o.cancelReason,
      quote: !(o.items ?? []).length,
      itemsCount: (o.items ?? []).length,
      hasPrescription: !!o.prescriptionId || !!o.prescriptionFileId,
      pharmacy: {
        id: o.pharmacyId,
        providerId: p.id,
        nameAr: p.nameAr,
        slug: p.slug,
        phone: p.phone,
        whatsappNumber: p.whatsappNumber,
        estimatedDeliveryMinutes: o.pharmacy!.estimatedDeliveryMinutes,
      },
      branch: o.branch ? { id: o.branch.id, name: o.branch.name, address: o.branch.address, phone: o.branch.phone, openingHours: o.branch.openingHours } : null,
      history,
      viewer,
      can: this.capabilities(user, viewer, o),
    };
    if (viewer === 'PLATFORM') return { ...base, patient: { fullName: o.patient?.user?.fullName } };

    let prescription: any = null;
    if (o.prescriptionId) {
      const rx = await this.prescriptions.load(o.prescriptionId);
      const st = this.prescriptions.state(rx);
      prescription = {
        id: rx.id,
        code: rx.code,
        state: st,
        stateLabel: RX_STATE_AR[st],
        issuedAt: rx.issuedAt,
        validUntil: rx.validUntil,
        doctorName: rx.doctor?.user?.fullName,
        diagnosis: viewer === 'PATIENT' ? rx.diagnosis : undefined,
        items: (rx.items ?? []).map((i) => ({ medicineId: i.medicineId, medicineName: i.medicineName, dose: i.dose, frequency: i.frequency, duration: i.duration, quantity: i.quantity, instructions: i.instructions })),
      };
      if (viewer === 'PHARMACY') {
        // Stock & price of each prescribed medicine at this pharmacy — for pricing a quote.
        const ids = prescription.items.map((i: any) => i.medicineId).filter(Boolean);
        const stock = ids.length
          ? await this.ds.query(`SELECT medicine_id, price::float AS price, in_stock, quantity FROM pharmacy_inventory WHERE pharmacy_id = $1 AND medicine_id = ANY($2::uuid[])`, [o.pharmacyId, ids])
          : [];
        const sm = new Map(stock.map((x: any) => [x.medicine_id, x]));
        prescription.items = prescription.items.map((i: any) => {
          const x: any = i.medicineId ? sm.get(i.medicineId) : null;
          return { ...i, stock: x ? { price: x.price, inStock: x.in_stock && (x.quantity == null || x.quantity > 0), quantity: x.quantity } : null };
        });
      }
    }
    const meds = (o.items ?? []).length
      ? await this.ds.query(`SELECT id, name_ar, requires_prescription, kind FROM medicines WHERE id = ANY($1::uuid[])`, [(o.items ?? []).map((i) => i.medicineId)])
      : [];
    const mMap = new Map(meds.map((x: any) => [x.id, x]));
    const pu = o.patient!;
    return {
      ...base,
      items: (o.items ?? []).map((i) => {
        const med: any = mMap.get(i.medicineId);
        return { id: i.id, medicineId: i.medicineId, name: i.medicineName, nameAr: med?.name_ar, kind: med?.kind, requiresPrescription: med?.requires_prescription, quantity: i.quantity, unitPrice: Number(i.unitPrice), lineTotal: Math.round(i.quantity * Number(i.unitPrice) * 100) / 100 };
      }),
      deliveryAddress: o.deliveryAddress,
      contactPhone: o.contactPhone,
      notes: o.notes,
      pharmacistNote: o.pharmacistNote,
      driverName: o.driverName,
      driverPhone: o.driverPhone,
      prescription,
      prescriptionFileId: o.prescriptionFileId,
      patient: viewer === 'PHARMACY' ? { id: pu.id, userId: pu.userId, fullName: pu.user?.fullName, phone: pu.user?.phone } : { id: pu.id, fullName: pu.user?.fullName },
    };
  }

  async list(user: AuthUser, scope: 'patient' | 'pharmacy' | 'admin', q: PharmacyOrdersQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.split('?').join(`$${params.length}`));
    };
    if (scope === 'patient') {
      if (!user.patientId) return paginate([], 0, q);
      add('o.patient_id = ?', user.patientId);
    } else if (scope === 'pharmacy') {
      const { pharmacy } = await this.catalog.myPharmacy(user);
      add('o.pharmacy_id = ?', pharmacy.id);
    } else if (q.pharmacyId) add('(o.pharmacy_id = ? OR ph.provider_id = ?)', q.pharmacyId);
    if (q.status) {
      const st = q.status.split(',').filter((s) => (Object.values(S) as string[]).includes(s));
      if (st.length) add('o.status = ANY(?::pharmacy_order_status[])', st);
    }
    if (q.fulfillment) add('o.fulfillment = ?', q.fulfillment);
    if (q.from) add('o.created_at >= ?', DateTime.fromISO(q.from, { zone: this.tz }).startOf('day').toJSDate());
    if (q.to) add('o.created_at <= ?', DateTime.fromISO(q.to, { zone: this.tz }).endOf('day').toJSDate());
    if (q.search?.trim()) {
      const s = `%${likeEscape(q.search.trim())}%`;
      if (scope === 'patient') add('(o.code ILIKE ? OR pr.name_ar ILIKE ?)', s);
      else if (scope === 'pharmacy') add('(o.code ILIKE ? OR u.full_name ILIKE ? OR u.phone ILIKE ? OR o.contact_phone ILIKE ?)', s);
      else add('(o.code ILIKE ? OR pr.name_ar ILIKE ? OR u.full_name ILIKE ?)', s);
    }
    const from = `FROM pharmacy_orders o JOIN pharmacies ph ON ph.id = o.pharmacy_id JOIN providers pr ON pr.id = ph.provider_id
      JOIN patients pa ON pa.id = o.patient_id JOIN users u ON u.id = pa.user_id`;
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total ${from} ${cond}`, params);
    const { skip, take } = skipTake(q);
    const dir = q.sortDir?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const rows = await this.ds.query(
      `SELECT o.id, o.code, o.status, o.fulfillment, o.total::float AS total, o.payment_status, o.created_at, o.delivered_at,
              o.prescription_id IS NOT NULL OR o.prescription_file_id IS NOT NULL AS has_prescription,
              pr.name_ar AS pharmacy_name, pr.slug AS pharmacy_slug, pr.id AS provider_id, u.full_name AS patient_name
              ${scope === 'pharmacy' ? ', u.phone AS patient_phone, o.delivery_address' : ''},
              (SELECT count(*) FROM pharmacy_order_items i WHERE i.order_id = o.id)::int AS items
              ${scope !== 'admin' ? ", (SELECT string_agg(i.medicine_name, '، ' ORDER BY i.medicine_name) FROM pharmacy_order_items i WHERE i.order_id = o.id) AS summary" : ''}
         ${from} ${cond} ORDER BY o.created_at ${dir} LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paginate(
      rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        statusLabel: PH_STATUS_AR[r.status as S],
        fulfillment: r.fulfillment,
        total: r.total,
        paymentStatus: r.payment_status,
        createdAt: r.created_at,
        deliveredAt: r.delivered_at,
        hasPrescription: r.has_prescription,
        items: r.items,
        summary: r.summary ?? undefined,
        pharmacy: { providerId: r.provider_id, nameAr: r.pharmacy_name, slug: r.pharmacy_slug },
        patientName: r.patient_name,
        patientPhone: r.patient_phone,
        deliveryAddress: r.delivery_address,
      })),
      total,
      q,
    );
  }

  // ─────────────── Pharmacy workflow ───────────────

  /**
   * Confirms (and, for quotes / substitutions, prices) the order and reserves stock.
   * Each stock row is decremented with a conditional UPDATE, so two confirmations
   * competing for the last packs cannot both succeed; any shortfall rolls back all lines.
   */
  async confirm(user: AuthUser, id: string, dto: ConfirmOrderDto, meta: Meta = {}) {
    const o = await this.ds.transaction(async (m) => {
      const o = await this.forPharmacy(user, id, m);
      if (o.status !== S.PENDING) throw new BadRequestException('تم التعامل مع هذا الطلب بالفعل');
      const current = await m.find(PharmacyOrderItem, { where: { orderId: o.id } });
      const cart = dto.items ?? current.map((i) => ({ medicineId: i.medicineId, quantity: i.quantity }));
      if (!cart.length) throw new BadRequestException('أضف أصناف الطلب وأسعارها قبل التأكيد');
      const rx = o.prescriptionId ? await m.findOne(Prescription, { where: { id: o.prescriptionId }, relations: { items: true } }) : null;
      if (rx) {
        const st = this.prescriptions.state(rx);
        if (st !== 'ACTIVE') throw new ConflictException({ message: `الروشتة المرفقة ${RX_STATE_AR[st]} — لا يمكن تأكيد الطلب`, code: `RX_${st}` });
      }
      const lines = await this.price(m, o.pharmacyId, cart, false);
      this.assertCovered(lines, rx, !!o.prescriptionFileId);

      for (const l of lines) {
        const res = await m.query(
          `UPDATE pharmacy_inventory
              SET quantity = CASE WHEN quantity IS NULL THEN NULL ELSE quantity - $3 END,
                  in_stock = CASE WHEN quantity IS NULL THEN in_stock ELSE quantity - $3 > 0 END,
                  updated_at = now()
            WHERE pharmacy_id = $1 AND medicine_id = $2 AND in_stock AND (quantity IS NULL OR quantity >= $3)`,
          [o.pharmacyId, l.medicineId, l.quantity],
        );
        if (!(res?.[1] > 0)) throw new ConflictException({ message: `${l.name}: الكمية في المخزون غير كافية — عدّل الكمية أو المخزون`, code: 'OUT_OF_STOCK', medicineId: l.medicineId });
      }
      const ph = (await m.findOne(Pharmacy, { where: { id: o.pharmacyId } }))!;
      const subtotal = Math.round(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) * 100) / 100;
      // The pharmacy accepted the order — its minimum / availability rules no longer block it.
      const deliveryFee = deliveryFeeFor({ ...ph, deliveryAvailable: true, minOrderForDelivery: 0 }, o.fulfillment, subtotal);
      const changed =
        !!dto.items &&
        (current.length !== lines.length || lines.some((l) => !current.find((c) => c.medicineId === l.medicineId && c.quantity === l.quantity)));
      if (dto.items) {
        await m.delete(PharmacyOrderItem, { orderId: o.id });
        await m.insert(
          PharmacyOrderItem,
          lines.map((l) => ({ orderId: o.id, medicineId: l.medicineId, medicineName: l.name, quantity: l.quantity, unitPrice: l.unitPrice })),
        );
      }
      // A coupon is re-applied to the final (possibly re-priced) lines; dropped if it no longer qualifies.
      const coupon = o.couponId ? await this.coupons.recompute(m, o.couponId, 'PHARMACY_ORDER', o.id, o.pharmacy!.providerId, subtotal) : { discount: 0, dropped: false };
      const patch = {
        status: S.CONFIRMED,
        subtotal,
        deliveryFee,
        discount: coupon.discount,
        couponId: coupon.dropped ? null : o.couponId,
        total: Math.round((subtotal + deliveryFee - coupon.discount) * 100) / 100,
        stockReserved: true,
        confirmedAt: new Date(),
        pharmacistNote: dto.pharmacistNote?.trim() || o.pharmacistNote,
      };
      await m.update(PharmacyOrder, o.id, patch);
      await this.history(m, o.id, o.status, S.CONFIRMED, user.id, changed ? (current.length ? 'تم تعديل الأصناف' : 'تم تسعير الروشتة') : dto.pharmacistNote?.trim() || null);
      await this.audit.log(
        { userId: user.id, action: 'PHARMACY_ORDER_CONFIRMED', entity: 'pharmacy_orders', entityId: o.id, oldValue: { total: o.total, items: current.length }, newValue: { total: patch.total, items: lines.length, changed }, ...meta },
        m,
      );
      return { ...o, ...patch, changed, quote: !current.length } as PharmacyOrder & { changed: boolean; quote: boolean };
    });
    await this.notifyPatient(
      o,
      o.quote ? 'تم تسعير روشتتك' : 'تم تأكيد طلب الصيدلية',
      `${o.code}: الإجمالي ${money(o.total)}${o.changed && !o.quote ? ' — عدّلت الصيدلية بعض الأصناف، راجع الطلب.' : ''}${o.pharmacistNote ? ` ملاحظة الصيدلي: ${o.pharmacistNote}` : ''}`,
      'PHARMACY_ORDER_CONFIRMED',
    );
    await this.broadcast(o);
    return this.get(user, id);
  }

  async changeStatus(user: AuthUser, id: string, dto: PharmacyStatusDto, meta: Meta = {}) {
    const o = await this.ds.transaction(async (m) => {
      const o = await this.forPharmacy(user, id, m);
      if (!nextStatuses(o.status, o.fulfillment).includes(dto.status)) {
        throw new BadRequestException(`لا يمكن نقل الطلب من "${PH_STATUS_AR[o.status]}" إلى "${PH_STATUS_AR[dto.status]}"`);
      }
      const now = new Date();
      const patch: Record<string, unknown> = { status: dto.status };
      if (dto.status === S.READY) patch.readyAt = now;
      if (dto.status === S.OUT_FOR_DELIVERY) {
        patch.outForDeliveryAt = now;
        patch.driverName = dto.driverName?.trim() || null;
        if (dto.driverPhone) {
          const p = normalizePhone(dto.driverPhone);
          if (!p) throw new BadRequestException('رقم المندوب غير صحيح');
          patch.driverPhone = p;
        }
      }
      if (dto.status === S.DELIVERED) {
        patch.deliveredAt = now;
        if (o.paymentStatus !== PaymentStatus.PAID) Object.assign(patch, { paymentStatus: PaymentStatus.PAID, paidAt: now, paymentMethod: dto.paymentMethod ?? o.paymentMethod ?? PaymentMethod.CASH });
        if (o.prescriptionId) await this.dispenseOnDelivery(m, user, o);
      }
      await m.update(PharmacyOrder, o.id, patch);
      if (patch.paymentStatus === PaymentStatus.PAID) await this.payments.recordOffline(m, 'PHARMACY_ORDER', o.id, patch.paymentMethod as PaymentMethod, user.id);
      await this.history(m, o.id, o.status, dto.status, user.id, dto.note);
      await this.audit.log({ userId: user.id, action: 'PHARMACY_STATUS_CHANGED', entity: 'pharmacy_orders', entityId: o.id, oldValue: { status: o.status }, newValue: { status: dto.status, note: dto.note }, ...meta }, m);
      return { ...o, ...patch } as PharmacyOrder;
    });
    const msgs: Partial<Record<S, [string, string]>> = {
      [S.PREPARING]: ['جاري تجهيز طلبك', `بدأت الصيدلية تجهيز الطلب ${o.code}.`],
      [S.READY]: o.fulfillment === FulfillmentType.PICKUP ? ['طلبك جاهز للاستلام', `الطلب ${o.code} جاهز. تفضل باستلامه من الفرع.`] : ['طلبك جاهز', `الطلب ${o.code} جاهز وسيخرج للتوصيل قريباً.`],
      [S.OUT_FOR_DELIVERY]: ['طلبك في الطريق', `الطلب ${o.code} خرج للتوصيل${o.driverName ? ` مع ${o.driverName}` : ''}${o.driverPhone ? ` (${o.driverPhone})` : ''}.`],
      [S.DELIVERED]: ['تم تسليم طلبك', `تم تسليم الطلب ${o.code}. نتمنى لك الشفاء العاجل.`],
    };
    const msg = msgs[o.status];
    if (msg) await this.notifyPatient(o, msg[0], msg[1], `PHARMACY_ORDER_${o.status}`);
    await this.broadcast(o);
    return this.get(user, id);
  }

  /** Delivering an order that fills an e-prescription records the dispensing — exactly once. */
  private async dispenseOnDelivery(m: EntityManager, user: AuthUser, o: PharmacyOrder) {
    const res = await m.query(
      `UPDATE prescriptions SET dispensed_at = now(), dispensed_by_provider_id = $2, dispensed_by_id = $3, dispensed_order_id = $4, pdf_file_id = NULL
        WHERE id = $1 AND dispensed_at IS NULL AND revoked_at IS NULL`,
      [o.prescriptionId, o.pharmacy!.providerId, user.id, o.id],
    );
    if (res?.[1] > 0) {
      await this.audit.log({ userId: user.id, action: 'PRESCRIPTION_DISPENSED', entity: 'prescriptions', entityId: o.prescriptionId!, newValue: { orderId: o.id, pharmacyProviderId: o.pharmacy!.providerId } }, m);
      const [rx] = await m.query(`SELECT id, code, patient_id FROM prescriptions WHERE id = $1`, [o.prescriptionId]);
      setImmediate(() => this.prescriptions.notifyDispensed({ id: rx.id, code: rx.code, patientId: rx.patient_id }, o.pharmacy!.providerId).catch(() => undefined));
      return;
    }
    const [rx] = await m.query(`SELECT revoked_at, dispensed_order_id FROM prescriptions WHERE id = $1`, [o.prescriptionId]);
    if (rx?.dispensed_order_id === o.id) return;
    if (rx?.revoked_at) throw new ConflictException({ message: 'ألغى الطبيب الروشتة المرتبطة بهذا الطلب — لا يمكن تسليمه. ألغِ الطلب.', code: 'RX_REVOKED' });
    throw new ConflictException({ message: 'تم صرف الروشتة المرتبطة من مكان آخر — راجع المريض قبل التسليم', code: 'RX_DISPENSED' });
  }

  async cancel(user: AuthUser, id: string, reason: string | undefined, meta: Meta = {}) {
    const { o, viewer } = await this.ds.transaction(async (m) => {
      const o = await m.findOne(PharmacyOrder, { where: { id }, relations: { pharmacy: { provider: true } }, lock: { mode: 'pessimistic_write', tables: ['pharmacy_orders'] } });
      if (!o) throw new NotFoundException('الطلب غير موجود');
      const viewer = await this.viewerFor(user, o);
      if (viewer === 'PATIENT') {
        if (!PATIENT_CANCELLABLE.includes(o.status)) throw new BadRequestException('لا يمكن إلغاء الطلب بعد بدء تجهيزه. تواصل مع الصيدلية.');
      } else if (viewer === 'PHARMACY') {
        if (!user.permissions.has(P.PHARMACY_ORDERS_MANAGE)) throw new ForbiddenException('لا تملك صلاحية إلغاء الطلبات');
        if (!PHARMACY_CANCELLABLE.includes(o.status)) throw new BadRequestException('لا يمكن إلغاء طلب خرج للتوصيل أو تم تسليمه');
        if (!reason?.trim()) throw new BadRequestException('اكتب سبب الإلغاء للمريض');
      } else throw new NotFoundException('الطلب غير موجود');
      if (o.stockReserved) {
        const items = await m.find(PharmacyOrderItem, { where: { orderId: o.id } });
        for (const i of items) {
          await m.query(
            `UPDATE pharmacy_inventory SET quantity = quantity + $3, in_stock = true, updated_at = now() WHERE pharmacy_id = $1 AND medicine_id = $2 AND quantity IS NOT NULL`,
            [o.pharmacyId, i.medicineId, i.quantity],
          );
        }
      }
      await m.update(PharmacyOrder, o.id, { status: S.CANCELLED, cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason?.trim() || null, stockReserved: false });
      await this.coupons.release(m, 'PHARMACY_ORDER', o.id);
      await this.history(m, o.id, o.status, S.CANCELLED, user.id, reason);
      await this.audit.log({ userId: user.id, action: 'PHARMACY_ORDER_CANCELLED', entity: 'pharmacy_orders', entityId: o.id, oldValue: { status: o.status }, newValue: { by: viewer, reason, stockRestored: o.stockReserved }, ...meta }, m);
      return { o, viewer };
    });
    await this.payments.refundOnCancel('PHARMACY_ORDER', o.id, `إلغاء طلب الصيدلية ${o.code}`);
    if (viewer === 'PATIENT') {
      await this.notifications.notifyMany(await this.teamUserIds(o.pharmacy!.providerId), {
        type: 'PHARMACY_ORDER_CANCELLED',
        category: 'PHARMACY',
        title: 'إلغاء طلب صيدلية',
        body: `ألغى المريض الطلب ${o.code}.`,
        data: { pharmacyOrderId: o.id },
      });
    } else {
      await this.notifyPatient(o, 'تم إلغاء طلب الصيدلية', `ألغت ${o.pharmacy!.provider!.nameAr} الطلب ${o.code}. السبب: ${reason}`, 'PHARMACY_ORDER_CANCELLED');
    }
    await this.broadcast({ ...o, status: S.CANCELLED });
    return this.get(user, id);
  }

  /** Uploaded paper prescriptions: the patient, and the pharmacy the patient sent it to. */
  async canReadFile(user: AuthUser, fileId: string) {
    const rows = await this.ds.query(
      `SELECT o.patient_id, ph.provider_id FROM pharmacy_orders o JOIN pharmacies ph ON ph.id = o.pharmacy_id WHERE o.prescription_file_id = $1`,
      [fileId],
    );
    return rows.some((r: any) => r.patient_id === user.patientId || (user.providerIds.includes(r.provider_id) && PHARMACY_PERMS.some((p) => user.permissions.has(p))));
  }

  /**
   * "Where can I fill this prescription?" — every live pharmacy with how many of the
   * prescribed medicines it has in stock and the price of the prescribed quantities.
   */
  async prescriptionOffers(user: AuthUser, rxId: string, cityId?: string) {
    const rx = await this.prescriptions.load(rxId);
    if (rx.patientId !== user.patientId) throw new NotFoundException('الروشتة غير موجودة');
    const meds = new Map<string, boolean>(
      (await this.ds.query(`SELECT id, requires_prescription FROM medicines WHERE id = ANY($1::uuid[])`, [(rx.items ?? []).map((i) => i.medicineId).filter(Boolean)])).map((m: any) => [m.id, m.requires_prescription]),
    );
    const lines = (rx.items ?? []).filter((i) => i.medicineId).map((i) => ({ medicineId: i.medicineId!, quantity: i.quantity ?? 1, name: i.medicineName, requiresPrescription: !!meds.get(i.medicineId!) }));
    const ids = lines.map((l) => l.medicineId);
    const rows = ids.length
      ? await this.ds.query(
          `SELECT ph.id AS pharmacy_id, p.id AS provider_id, p.name_ar, p.slug, p.logo_file_id, p.rating_avg::float AS rating_avg, ph.delivery_available, ph.delivery_fee::float AS delivery_fee,
                  ph.free_delivery_over::float AS free_delivery_over, ph.min_order_for_delivery::float AS min_order_for_delivery, ph.estimated_delivery_minutes, ph.is24_hours,
                  json_agg(json_build_object('medicineId', pi.medicine_id, 'price', pi.price::float, 'quantity', pi.quantity)) AS stock,
                  (SELECT json_build_object('city', c.name_ar, 'area', a.name_ar) FROM provider_branches b LEFT JOIN cities c ON c.id = b.city_id LEFT JOIN areas a ON a.id = b.area_id
                    WHERE b.provider_id = p.id AND b.is_active ORDER BY b.created_at LIMIT 1) AS place
             FROM pharmacy_inventory pi JOIN pharmacies ph ON ph.id = pi.pharmacy_id JOIN providers p ON p.id = ph.provider_id
            WHERE pi.medicine_id = ANY($1::uuid[]) AND pi.in_stock AND (pi.quantity IS NULL OR pi.quantity > 0)
              AND ph.id IN (SELECT ph2.id FROM pharmacies ph2 JOIN providers p2 ON p2.id = ph2.provider_id JOIN users ow ON ow.id = p2.owner_user_id
                             WHERE p2.verification_status = 'APPROVED' AND p2.is_active AND p2.subscription_active AND ow.status = 'ACTIVE')
              AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM provider_branches b WHERE b.provider_id = p.id AND b.is_active AND b.city_id = $2::uuid))
            GROUP BY ph.id, p.id`,
          [ids, cityId ?? null],
        )
      : [];
    const st = this.prescriptions.state(rx);
    return {
      prescription: { id: rx.id, code: rx.code, state: st, stateLabel: RX_STATE_AR[st], items: lines.length, freeText: (rx.items ?? []).filter((i) => !i.medicineId).map((i) => i.medicineName) },
      pharmacies: rows
        .map((r: any) => {
          const stock = new Map<string, any>(r.stock.map((s: any) => [s.medicineId, s]));
          const available = lines.filter((l) => {
            const s = stock.get(l.medicineId);
            return s && (s.quantity == null || s.quantity >= l.quantity);
          });
          const subtotal = Math.round(available.reduce((sum, l) => sum + stock.get(l.medicineId).price * l.quantity, 0) * 100) / 100;
          return {
            pharmacy: { id: r.pharmacy_id, providerId: r.provider_id, nameAr: r.name_ar, slug: r.slug, logoFileId: r.logo_file_id, ratingAvg: r.rating_avg, city: r.place?.city, area: r.place?.area, is24Hours: r.is24_hours },
            available: available.length,
            missing: lines.filter((l) => !available.includes(l)).map((l) => l.name),
            subtotal,
            deliveryAvailable: r.delivery_available,
            deliveryFee: r.delivery_available ? (r.free_delivery_over != null && subtotal >= r.free_delivery_over ? 0 : r.delivery_fee ?? 0) : null,
            estimatedDeliveryMinutes: r.estimated_delivery_minutes,
            items: available.map((l) => ({ medicineId: l.medicineId, name: l.name, quantity: l.quantity, unitPrice: stock.get(l.medicineId).price, requiresPrescription: l.requiresPrescription })),
          };
        })
        .sort((a: any, b: any) => b.available - a.available || a.subtotal - b.subtotal),
    };
  }

  // ─────────────── Dashboard ───────────────

  async dashboard(user: AuthUser, fromIso?: string, toIso?: string) {
    const { pharmacy } = await this.catalog.myPharmacy(user);
    const tz = this.tz;
    const now = DateTime.now().setZone(tz);
    const from = (fromIso ? DateTime.fromISO(fromIso, { zone: tz }) : now.minus({ days: 29 })).startOf('day').toJSDate();
    const to = (toIso ? DateTime.fromISO(toIso, { zone: tz }) : now).endOf('day').toJSDate();
    const d0 = now.startOf('day').toJSDate();
    const id = pharmacy.id;
    const [live] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
              count(*) FILTER (WHERE status = 'CONFIRMED')::int AS confirmed,
              count(*) FILTER (WHERE status = 'PREPARING')::int AS preparing,
              count(*) FILTER (WHERE status = 'READY')::int AS ready,
              count(*) FILTER (WHERE status = 'OUT_FOR_DELIVERY')::int AS out_for_delivery,
              count(*) FILTER (WHERE status = 'DELIVERED' AND delivered_at >= $2)::int AS delivered_today,
              count(*) FILTER (WHERE status = 'CANCELLED' AND cancelled_at >= $2)::int AS cancelled_today,
              count(*) FILTER (WHERE created_at >= $2)::int AS new_today,
              coalesce(sum(total) FILTER (WHERE status = 'DELIVERED' AND delivered_at >= $2), 0)::float AS revenue_today
         FROM pharmacy_orders WHERE pharmacy_id = $1`,
      [id, d0],
    );
    const [tot] = await this.ds.query(
      `SELECT count(*)::int AS orders,
              count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
              count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
              count(DISTINCT patient_id) FILTER (WHERE status <> 'CANCELLED')::int AS customers,
              coalesce(sum(total) FILTER (WHERE status = 'DELIVERED'), 0)::float AS revenue,
              coalesce(avg(total) FILTER (WHERE status = 'DELIVERED'), 0)::float AS avg_order,
              count(*) FILTER (WHERE fulfillment = 'DELIVERY' AND status <> 'CANCELLED')::int AS delivery_orders,
              count(*) FILTER (WHERE fulfillment = 'PICKUP' AND status <> 'CANCELLED')::int AS pickup_orders,
              avg(extract(epoch FROM (delivered_at - created_at)) / 60) FILTER (WHERE status = 'DELIVERED')::float AS avg_fulfil_min,
              avg(extract(epoch FROM (delivered_at - out_for_delivery_at)) / 60) FILTER (WHERE status = 'DELIVERED' AND fulfillment = 'DELIVERY')::float AS avg_delivery_min,
              count(*) FILTER (WHERE prescription_id IS NOT NULL OR prescription_file_id IS NOT NULL)::int AS with_rx
         FROM pharmacy_orders WHERE pharmacy_id = $1 AND created_at BETWEEN $2 AND $3`,
      [id, from, to],
    );
    const [repeat] = await this.ds.query(
      `SELECT count(*)::int AS n FROM (SELECT patient_id FROM pharmacy_orders WHERE pharmacy_id = $1 AND status = 'DELIVERED' AND created_at BETWEEN $2 AND $3 GROUP BY patient_id HAVING count(*) > 1) x`,
      [id, from, to],
    );
    const topMedicines = await this.ds.query(
      `SELECT i.medicine_id, max(i.medicine_name) AS name, sum(i.quantity)::int AS quantity, sum(i.quantity * i.unit_price)::float AS revenue, count(DISTINCT o.id)::int AS orders
         FROM pharmacy_order_items i JOIN pharmacy_orders o ON o.id = i.order_id
        WHERE o.pharmacy_id = $1 AND o.status = 'DELIVERED' AND o.created_at BETWEEN $2 AND $3
        GROUP BY i.medicine_id ORDER BY sum(i.quantity) DESC LIMIT 10`,
      [id, from, to],
    );
    const daily = await this.ds.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date,
              (SELECT count(*) FROM pharmacy_orders o WHERE o.pharmacy_id = $1 AND (o.created_at AT TIME ZONE $4)::date = d::date)::int AS orders,
              (SELECT coalesce(sum(o.total), 0) FROM pharmacy_orders o WHERE o.pharmacy_id = $1 AND o.status = 'DELIVERED' AND (o.delivered_at AT TIME ZONE $4)::date = d::date)::float AS revenue
         FROM generate_series(($2::timestamptz AT TIME ZONE $4)::date, ($3::timestamptz AT TIME ZONE $4)::date, interval '1 day') d`,
      [id, from, to, tz],
    );
    const lowStock = await this.ds.query(
      `SELECT pi.id, pi.quantity, pi.price::float AS price, m.name_en, m.strength, m.form FROM pharmacy_inventory pi JOIN medicines m ON m.id = pi.medicine_id
        WHERE pi.pharmacy_id = $1 AND pi.quantity IS NOT NULL AND pi.quantity <= 5 ORDER BY pi.quantity ASC, m.name_en LIMIT 10`,
      [id],
    );
    const [rx] = await this.ds.query(`SELECT count(*)::int AS n FROM prescriptions WHERE dispensed_by_provider_id = $1 AND dispensed_at BETWEEN $2 AND $3`, [pharmacy.providerId, from, to]);
    const r1 = (v: number | null) => (v == null ? null : Math.round(v));
    return {
      live: {
        pending: live.pending,
        confirmed: live.confirmed,
        preparing: live.preparing,
        ready: live.ready,
        outForDelivery: live.out_for_delivery,
        deliveredToday: live.delivered_today,
        cancelledToday: live.cancelled_today,
        newToday: live.new_today,
        revenueToday: live.revenue_today,
      },
      totals: {
        orders: tot.orders,
        delivered: tot.delivered,
        cancelled: tot.cancelled,
        customers: tot.customers,
        repeatCustomers: repeat.n,
        revenue: tot.revenue,
        avgOrder: Math.round(tot.avg_order * 100) / 100,
        deliveryOrders: tot.delivery_orders,
        pickupOrders: tot.pickup_orders,
        avgFulfilMinutes: r1(tot.avg_fulfil_min),
        avgDeliveryMinutes: r1(tot.avg_delivery_min),
        withPrescription: tot.with_rx,
        prescriptionsDispensed: rx.n,
      },
      topMedicines,
      daily,
      lowStock: lowStock.map((l: any) => ({ id: l.id, name: medicineLabel({ nameEn: l.name_en, strength: l.strength, form: l.form }), quantity: l.quantity, price: l.price })),
    };
  }
}
