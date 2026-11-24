import { CouponsService } from '../payments/coupons.service';
import { PaymentsService } from '../payments/payments.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { DataSource, EntityManager, In } from 'typeorm';
import { randomInt } from 'crypto';
import {
  LabOrder,
  LabOrderItem,
  LabOrderStatus,
  LabOrderStatusHistory,
  LabPackage,
  LabResult,
  LabSample,
  LabTest,
  Laboratory,
  Patient,
  PaymentMethod,
  PaymentStatus,
  ProviderBranch,
  VerificationStatus,
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
import { LabCatalogService } from './lab-catalog.service';
import { BookLabOrderDto, LabOrdersQuery, LabStatusDto, SlotsQuery } from './labs.dto';
import {
  ACTIVE_LAB_STATUSES,
  LAB_CANCELLABLE,
  LAB_STATUS_AR,
  MANUAL_TRANSITIONS,
  PATIENT_CANCELLABLE,
  RELEASED_STATUSES,
  ageInYears,
  buildWindows,
} from './lab-logic';

export type LabViewer = 'PATIENT' | 'LAB' | 'PLATFORM';
const HOME_WINDOW_MINUTES = 60;

interface Meta {
  ip?: string;
  userAgent?: string | null;
}

@Injectable()
export class LabOrdersService {
  readonly tz: string;

  constructor(
    private ds: DataSource,
    config: ConfigService,
    private catalog: LabCatalogService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private gateway: NotificationsGateway,
    private settings: SettingsService,
    private coupons: CouponsService,
    private payments: PaymentsService,
  ) {
    this.tz = config.get<string>('timezone')!;
  }

  fmt(d: Date | string) {
    return DateTime.fromJSDate(new Date(d)).setZone(this.tz).setLocale('ar-EG').toFormat('cccc d LLLL - h:mm a');
  }

  // ─────────────── Team / realtime helpers ───────────────

  /** Owner + active staff of the provider. */
  async teamUserIds(providerId: string, m: EntityManager = this.ds.manager, adminsOnly = false): Promise<string[]> {
    const rows: { id: string }[] = await m.query(
      `SELECT owner_user_id AS id FROM providers WHERE id = $1
       UNION SELECT user_id FROM provider_staff WHERE provider_id = $1 AND is_active ${adminsOnly ? 'AND is_admin' : ''}`,
      [providerId],
    );
    return rows.map((r) => r.id);
  }

  async broadcast(order: { id: string; status: LabOrderStatus; patientId: string; laboratoryId: string }) {
    const [row] = await this.ds.query(
      `SELECT pa.user_id, l.provider_id FROM patients pa, laboratories l WHERE pa.id = $1 AND l.id = $2`,
      [order.patientId, order.laboratoryId],
    );
    if (!row) return;
    const team = await this.teamUserIds(row.provider_id);
    this.gateway.emitToUsers([...team, row.user_id], 'lab:order', { id: order.id, status: order.status });
  }

  async history(m: EntityManager, orderId: string, from: LabOrderStatus | null, to: LabOrderStatus, by: string | null, note?: string | null) {
    await m.insert(LabOrderStatusHistory, { orderId, fromStatus: from, toStatus: to, changedById: by, note: note ?? null });
  }

  /** Serialises bookings per laboratory so capacity can never be oversold under concurrency. */
  private lockLab(m: EntityManager, labId: string) {
    return m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 77))`, [`lab:${labId}`]);
  }

  // ─────────────── Availability ───────────────

  private async bookedCounts(m: EntityManager, labId: string, mode: 'BRANCH' | 'HOME', branchId: string | null, dayStart: Date, dayEnd: Date) {
    const params: unknown[] = [labId, mode === 'HOME', dayStart, dayEnd];
    let branchCond = '';
    if (mode === 'BRANCH') {
      params.push(branchId);
      branchCond = `AND branch_id = $5`;
    }
    const rows: { scheduled_at: Date; n: number }[] = await m.query(
      `SELECT scheduled_at, count(*)::int AS n FROM lab_orders
        WHERE laboratory_id = $1 AND home_collection = $2 AND status <> 'CANCELLED'
          AND scheduled_at >= $3 AND scheduled_at < $4 ${branchCond}
        GROUP BY scheduled_at`,
      params,
    );
    return new Map(rows.map((r) => [new Date(r.scheduled_at).toISOString(), r.n]));
  }

  private async windowsFor(m: EntityManager, lab: Laboratory, mode: 'BRANCH' | 'HOME', date: string, branch: ProviderBranch | null) {
    const day = DateTime.fromISO(date, { zone: this.tz });
    if (!day.isValid) throw new BadRequestException('تاريخ غير صحيح');
    const booked = await this.bookedCounts(m, lab.id, mode, branch?.id ?? null, day.startOf('day').toJSDate(), day.endOf('day').toJSDate());
    const minLead = await this.settings.get<number>('booking.minLeadMinutes');
    return buildWindows({
      hours: mode === 'HOME' ? lab.homeCollectionHours : branch?.openingHours,
      date,
      tz: this.tz,
      windowMinutes: mode === 'HOME' ? HOME_WINDOW_MINUTES : lab.slotMinutes,
      capacity: mode === 'HOME' ? lab.homeSlotCapacity : lab.slotCapacity,
      booked,
      now: new Date(),
      minLeadMinutes: minLead,
      horizonDays: lab.bookingHorizonDays,
    });
  }

  async slots(labKey: string, q: SlotsQuery) {
    const lab = await this.catalog.publicLab(labKey);
    let branch: ProviderBranch | null = null;
    if (q.mode === 'BRANCH') {
      if (!q.branchId) throw new BadRequestException('اختر الفرع');
      branch = await this.ds.getRepository(ProviderBranch).findOneBy({ id: q.branchId, providerId: lab.providerId, isActive: true });
      if (!branch) throw new NotFoundException('الفرع غير موجود');
    } else if (!lab.homeCollection) {
      return { date: q.date, mode: q.mode, slots: [] };
    }
    const slots = await this.windowsFor(this.ds.manager, lab, q.mode, q.date, branch);
    return { date: q.date, mode: q.mode, timezone: this.tz, slots };
  }

  // ─────────────── Booking ───────────────

  async book(user: AuthUser, dto: BookLabOrderDto, meta: Meta = {}) {
    const patientId = user.patientId;
    if (!patientId) throw new ForbiddenException('يجب أن يكون لديك ملف مريض لحجز التحاليل');
    const scheduledAt = new Date(dto.scheduledAt);
    if (isNaN(scheduledAt.getTime())) throw new BadRequestException('موعد غير صحيح');
    const maxActive = await this.settings.get<number>('lab.maxActiveOrdersPerPatient');

    const order = await this.ds.transaction(async (m) => {
      await this.lockLab(m, dto.laboratoryId);
      const lab = await m.findOne(Laboratory, { where: { id: dto.laboratoryId }, relations: { provider: { owner: true } } });
      const provider = lab?.provider;
      if (!lab || !provider || provider.verificationStatus !== VerificationStatus.APPROVED || !provider.isActive || !provider.subscriptionActive || provider.owner?.status !== 'ACTIVE') {
        throw new BadRequestException('هذا المعمل غير متاح للحجز حالياً');
      }
      if ((await this.teamUserIds(provider.id, m)).includes(user.id)) throw new BadRequestException('لا يمكنك الحجز في المعمل الذي تعمل به');

      const patient = await m.findOne(Patient, { where: { id: patientId }, relations: { user: true } });
      if (!patient || patient.user?.status !== 'ACTIVE') throw new BadRequestException('حساب المريض غير مفعل');

      // Items — prices always come from the database, never from the client.
      const testIds = [...new Set(dto.testIds ?? [])];
      const packageIds = [...new Set(dto.packageIds ?? [])];
      if (!testIds.length && !packageIds.length) throw new BadRequestException('اختر تحليلاً أو باقة واحدة على الأقل');
      const tests = testIds.length ? await m.find(LabTest, { where: { id: In(testIds), laboratoryId: lab.id, isActive: true } }) : [];
      if (tests.length !== testIds.length) throw new BadRequestException('بعض التحاليل المختارة غير متاحة في هذا المعمل');
      const packages = packageIds.length
        ? await m.find(LabPackage, { where: { id: In(packageIds), laboratoryId: lab.id, isActive: true, isVisible: true }, relations: { items: { test: true } } })
        : [];
      if (packages.length !== packageIds.length || packages.some((p) => p.items?.some((i) => !i.test?.isActive))) {
        throw new BadRequestException('بعض الباقات المختارة غير متاحة حالياً');
      }
      const covered = new Map<string, string>();
      for (const p of packages) {
        for (const i of p.items ?? []) {
          if (covered.has(i.testId)) throw new BadRequestException(`التحليل "${i.test!.name}" مكرر في أكثر من باقة`);
          covered.set(i.testId, p.name);
        }
      }
      const dup = tests.find((t) => covered.has(t.id));
      if (dup) throw new BadRequestException(`التحليل "${dup.name}" موجود بالفعل ضمن "${covered.get(dup.id)}"`);

      // Where & when
      let branch: ProviderBranch | null = null;
      let homeAddress: string | null = null;
      if (dto.mode === 'BRANCH') {
        if (!dto.branchId) throw new BadRequestException('اختر الفرع');
        branch = await m.findOne(ProviderBranch, { where: { id: dto.branchId, providerId: provider.id, isActive: true } });
        if (!branch) throw new BadRequestException('الفرع المختار غير متاح');
      } else {
        if (!lab.homeCollection || !lab.homeCollectionHours?.length || lab.homeSlotCapacity < 1) throw new BadRequestException('المعمل لا يقدم خدمة السحب المنزلي حالياً');
        homeAddress = dto.homeAddress?.trim() || null;
        if (!homeAddress) throw new BadRequestException('من فضلك أدخل عنوان سحب العينة');
      }
      const localDate = DateTime.fromJSDate(scheduledAt).setZone(this.tz).toISODate()!;
      const windows = await this.windowsFor(m, lab, dto.mode, localDate, branch);
      const win = windows.find((w) => w.startAt === scheduledAt.toISOString());
      if (!win) throw new BadRequestException({ message: 'الموعد المختار غير متاح', code: 'INVALID_SLOT' });
      if (win.remaining < 1) throw new ConflictException({ message: 'هذا الموعد اكتمل، من فضلك اختر موعداً آخر', code: 'SLOT_FULL' });

      const active = await m.count(LabOrder, { where: { patientId, status: In(ACTIVE_LAB_STATUSES) } });
      if (active >= maxActive) throw new BadRequestException(`لا يمكن أن يكون لديك أكثر من ${maxActive} طلبات تحاليل مفتوحة`);
      if (await m.exists(LabOrder, { where: { patientId, laboratoryId: lab.id, scheduledAt, status: In(ACTIVE_LAB_STATUSES) } })) {
        throw new ConflictException({ message: 'لديك حجز بالفعل في نفس الموعد لدى هذا المعمل', code: 'DUPLICATE_ORDER' });
      }

      let contactPhone: string | null = null;
      if (dto.contactPhone) {
        contactPhone = normalizePhone(dto.contactPhone);
        if (!contactPhone) throw new BadRequestException('رقم التواصل غير صحيح');
      }
      const round = (n: number) => Math.round(n * 100) / 100;
      const subtotal = round(tests.reduce((s, t) => s + Number(t.price), 0) + packages.reduce((s, p) => s + Number(p.price), 0));
      const homeFee = dto.mode === 'HOME' ? Number(lab.homeCollectionFee ?? 0) : 0;
      const o = await m.save(
        m.create(LabOrder, {
          code: humanCode('LAB'),
          laboratoryId: lab.id,
          patientId,
          branchId: branch?.id ?? null,
          scheduledAt,
          homeCollection: dto.mode === 'HOME',
          homeAddress,
          contactPhone,
          status: LabOrderStatus.NEW_ORDER,
          subtotal,
          homeFee,
          discount: 0,
          total: round(subtotal + homeFee),
          paymentStatus: PaymentStatus.PENDING,
          notes: dto.notes ?? null,
          createdById: user.id,
        }),
      );
      await m.save([
        ...tests.map((t) => m.create(LabOrderItem, { orderId: o.id, testId: t.id, price: t.price })),
        ...packages.map((p) => m.create(LabOrderItem, { orderId: o.id, packageId: p.id, price: p.price })),
      ]);
      if (dto.couponCode?.trim()) {
        // The discount applies to the tests, never to the home-collection fee.
        const c = await this.coupons.redeem(m, { code: dto.couponCode, entityType: 'LAB_ORDER', entityId: o.id, providerId: provider.id, amount: subtotal, patientId });
        o.discount = c.discount;
        o.total = round(subtotal + homeFee - c.discount);
        await m.update(LabOrder, o.id, { discount: o.discount, total: o.total, couponId: c.couponId });
      }
      await this.history(m, o.id, null, LabOrderStatus.NEW_ORDER, user.id);
      await this.audit.log({ userId: user.id, action: 'LAB_ORDER_BOOKED', entity: 'lab_orders', entityId: o.id, newValue: { code: o.code, laboratoryId: lab.id, scheduledAt, total: o.total }, ...meta }, m);
      return { o, providerId: provider.id, labName: provider.nameAr, branchName: branch?.name ?? null };
    });

    const { o, providerId, labName, branchName } = order;
    const when = this.fmt(o.scheduledAt!);
    await this.notifications.notify(user.id, {
      type: 'LAB_ORDER_BOOKED',
      category: 'LAB_RESULTS',
      title: 'تم تأكيد حجز التحاليل',
      body: `طلبك ${o.code} لدى ${labName} ${o.homeCollection ? 'بسحب منزلي' : `في ${branchName}`} يوم ${when}. الإجمالي ${o.total} ج.م.`,
      data: { labOrderId: o.id },
    });
    await this.notifications.notifyMany(await this.teamUserIds(providerId), {
      type: 'LAB_ORDER_NEW',
      category: 'LAB_RESULTS',
      title: o.homeCollection ? 'طلب سحب منزلي جديد' : 'طلب تحاليل جديد',
      body: `${o.code} — ${user.fullName} — ${when}`,
      data: { labOrderId: o.id },
    });
    await this.broadcast(o);
    return this.get(user, o.id);
  }

  // ─────────────── Reading ───────────────

  /** Decides which view of an order the user gets. Unknown orders and foreign orders both look like 404. */
  async viewerFor(user: AuthUser, order: { patientId: string; laboratory?: { providerId: string } | null }): Promise<LabViewer> {
    if (user.patientId && order.patientId === user.patientId) return 'PATIENT';
    if (order.laboratory && user.providerIds.includes(order.laboratory.providerId)) return 'LAB';
    if (user.permissions.has(P.LAB_ORDERS_READ_ANY)) return 'PLATFORM';
    throw new NotFoundException('الطلب غير موجود');
  }

  async load(id: string, m: EntityManager = this.ds.manager) {
    const o = await m.findOne(LabOrder, {
      where: { id },
      relations: { laboratory: { provider: true }, branch: true, items: { test: true, package: { items: { test: true } } }, samples: true, patient: { user: true } },
    });
    if (!o) throw new NotFoundException('الطلب غير موجود');
    return o;
  }

  /** Flattened list of tests in an order (packages expanded). */
  expandTests(o: LabOrder) {
    const out: { testId: string; name: string; code: string; sampleType: string | null; packageName: string | null }[] = [];
    for (const it of o.items ?? []) {
      if (it.test) out.push({ testId: it.test.id, name: it.test.name, code: it.test.code, sampleType: it.test.sampleType, packageName: null });
      for (const pi of it.package?.items ?? []) {
        if (pi.test) out.push({ testId: pi.test.id, name: pi.test.name, code: pi.test.code, sampleType: pi.test.sampleType, packageName: it.package!.name });
      }
    }
    return out;
  }

  async get(user: AuthUser, id: string) {
    const o = await this.load(id);
    const viewer = await this.viewerFor(user, o);
    const history = await this.ds.query(
      `SELECT h.from_status, h.to_status, h.note, h.created_at, u.full_name AS by_name
         FROM lab_order_status_history h LEFT JOIN users u ON u.id = h.changed_by_id
        WHERE h.order_id = $1 ORDER BY h.created_at ASC`,
      [id],
    );
    const result = await this.ds.getRepository(LabResult).findOne({ where: { orderId: id } });
    const p = o.laboratory!.provider!;
    const base = {
      id: o.id,
      code: o.code,
      status: o.status,
      statusLabel: LAB_STATUS_AR[o.status],
      scheduledAt: o.scheduledAt,
      homeCollection: o.homeCollection,
      homeAddress: viewer === 'PLATFORM' ? null : o.homeAddress,
      contactPhone: viewer === 'PLATFORM' ? null : o.contactPhone,
      subtotal: o.subtotal,
      homeFee: o.homeFee,
      discount: o.discount,
      total: o.total,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      paidAt: o.paidAt,
      notes: viewer === 'PLATFORM' ? null : o.notes,
      cancelledAt: o.cancelledAt,
      cancelReason: o.cancelReason,
      deliveredAt: o.deliveredAt,
      createdAt: o.createdAt,
      laboratory: { id: o.laboratoryId, providerId: p.id, nameAr: p.nameAr, slug: p.slug, phone: p.phone, whatsappNumber: p.whatsappNumber, logoFileId: p.logoFileId },
      branch: o.branch ? { id: o.branch.id, name: o.branch.name, address: o.branch.address, phone: o.branch.phone } : null,
      items: (o.items ?? []).map((it) => ({
        id: it.id,
        price: it.price,
        test: it.test ? { id: it.test.id, code: it.test.code, name: it.test.name, sampleType: it.test.sampleType, preparationInstructions: it.test.preparationInstructions } : null,
        package: it.package ? { id: it.package.id, name: it.package.name, tests: (it.package.items ?? []).map((pi) => ({ id: pi.test!.id, code: pi.test!.code, name: pi.test!.name })) } : null,
      })),
      history,
      viewer,
      can: this.capabilities(user, viewer, o, result),
    };
    if (viewer === 'PLATFORM') return { ...base, patient: { fullName: o.patient?.user?.fullName } };
    const samples = (o.samples ?? [])
      .sort((a, b) => +a.createdAt - +b.createdAt)
      .map((s) => ({ id: s.id, barcode: s.barcode, sampleType: s.sampleType, testsLabel: s.testsLabel, collectedAt: s.collectedAt, receivedAt: s.receivedAt, rejectedAt: s.rejectedAt, rejectReason: s.rejectReason }));
    const released = RELEASED_STATUSES.includes(o.status);
    const pu = o.patient!;
    return {
      ...base,
      patient:
        viewer === 'LAB'
          ? { id: pu.id, userId: pu.userId, fullName: pu.user?.fullName, phone: pu.user?.phone, gender: pu.gender, ageYears: ageInYears(pu.dateOfBirth, o.createdAt), dateOfBirth: pu.dateOfBirth }
          : { id: pu.id, fullName: pu.user?.fullName },
      samples,
      result:
        result && (viewer === 'LAB' || released)
          ? {
              id: result.id,
              enteredAt: result.enteredAt,
              reviewedAt: result.reviewedAt,
              approvedAt: result.approvedAt,
              criticalCount: result.criticalCount,
              returnNote: viewer === 'LAB' ? result.returnNote : null,
              notes: result.notes,
              verificationCode: released ? result.verificationCode : null,
            }
          : null,
    };
  }

  capabilities(user: AuthUser, viewer: LabViewer, o: LabOrder, result: LabResult | null) {
    const has = (p: string) => user.permissions.has(p);
    const lab = viewer === 'LAB';
    const manual = MANUAL_TRANSITIONS[o.status] ?? [];
    return {
      transitions: lab && has(P.LAB_ORDERS_MANAGE) ? manual : [],
      recordPayment: lab && has(P.LAB_ORDERS_MANAGE) && o.paymentStatus !== PaymentStatus.PAID && o.status !== LabOrderStatus.CANCELLED,
      cancel: (viewer === 'PATIENT' && PATIENT_CANCELLABLE.includes(o.status)) || (lab && has(P.LAB_ORDERS_MANAGE) && LAB_CANCELLABLE.includes(o.status)),
      rejectSample: lab && has(P.LAB_ORDERS_MANAGE) && [LabOrderStatus.SAMPLE_COLLECTED, LabOrderStatus.SAMPLE_RECEIVED, LabOrderStatus.PROCESSING].includes(o.status),
      enterResults: lab && has(P.LAB_RESULTS_ENTER) && [LabOrderStatus.PROCESSING, LabOrderStatus.RESULT_ENTERED].includes(o.status),
      submitForReview: lab && has(P.LAB_RESULTS_ENTER) && o.status === LabOrderStatus.RESULT_ENTERED,
      review: lab && has(P.LAB_RESULTS_REVIEW) && o.status === LabOrderStatus.UNDER_REVIEW,
      approve:
        lab &&
        has(P.LAB_RESULTS_APPROVE) &&
        o.status === LabOrderStatus.UNDER_REVIEW &&
        !(o.laboratory?.requireSeparateApprover && result?.enteredById === user.id),
      viewResults: lab ? !!result : RELEASED_STATUSES.includes(o.status),
      downloadReport: RELEASED_STATUSES.includes(o.status) && viewer !== 'PLATFORM',
      previewReport: lab && !!result && [LabOrderStatus.RESULT_ENTERED, LabOrderStatus.UNDER_REVIEW].includes(o.status),
      chat: viewer !== 'PLATFORM',
    };
  }

  async list(user: AuthUser, scope: 'patient' | 'lab' | 'admin', q: LabOrdersQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (scope === 'patient') {
      if (!user.patientId) return paginate([], 0, q);
      add('o.patient_id = ?', user.patientId);
    } else if (scope === 'lab') {
      const { lab } = await this.catalog.myLab(user);
      add('o.laboratory_id = ?', lab.id);
      if (q.branchId) add('o.branch_id = ?', q.branchId);
      if (q.critical === 'true') where.push('r.critical_count > 0');
    } else if (q.laboratoryId) add('o.laboratory_id = ?', q.laboratoryId);
    if (q.status) {
      const st = q.status.split(',').filter((s) => (Object.values(LabOrderStatus) as string[]).includes(s));
      if (st.length) add('o.status = ANY(?::lab_order_status[])', st);
    }
    if (q.mode) where.push(q.mode === 'HOME' ? 'o.home_collection' : 'NOT o.home_collection');
    if (q.from) add('o.scheduled_at >= ?', new Date(q.from));
    if (q.to) add('o.scheduled_at <= ?', new Date(q.to));
    if (q.search) {
      const s = `%${likeEscape(q.search)}%`;
      if (scope === 'patient') add(`(o.code ILIKE ? OR pr.name_ar ILIKE $${params.length + 1})`, s);
      else {
        add(`(o.code ILIKE ? OR u.full_name ILIKE $${params.length + 1} OR u.phone ILIKE $${params.length + 1} OR EXISTS (SELECT 1 FROM lab_samples sx WHERE sx.order_id = o.id AND sx.barcode = $${params.length + 2}))`, s);
        params.push(s, q.search.trim());
      }
    }
    const from = `FROM lab_orders o
      JOIN laboratories l ON l.id = o.laboratory_id JOIN providers pr ON pr.id = l.provider_id
      JOIN patients pa ON pa.id = o.patient_id JOIN users u ON u.id = pa.user_id
      LEFT JOIN provider_branches b ON b.id = o.branch_id
      LEFT JOIN lab_results r ON r.order_id = o.id`;
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total ${from} ${cond}`, params);
    const { skip, take } = skipTake(q);
    const dir = q.sortDir?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const rows = await this.ds.query(
      `SELECT o.id, o.code, o.status, o.scheduled_at, o.home_collection, o.total::float AS total, o.payment_status, o.created_at,
              pr.name_ar AS lab_name, pr.slug AS lab_slug, pr.id AS provider_id, b.name AS branch_name,
              u.full_name AS patient_name, ${scope === 'lab' ? 'u.phone AS patient_phone, r.critical_count,' : ''}
              (SELECT count(*) FROM lab_order_items i WHERE i.order_id = o.id)::int AS items_count,
              (SELECT string_agg(coalesce(t.code, pk.name), '، ' ORDER BY i.created_at) FROM lab_order_items i
                 LEFT JOIN lab_tests t ON t.id = i.test_id LEFT JOIN lab_packages pk ON pk.id = i.package_id WHERE i.order_id = o.id) AS items_label
         ${from} ${cond}
        ORDER BY ${scope === 'patient' ? 'o.created_at' : 'o.scheduled_at'} ${dir} NULLS LAST
        LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paginate(
      rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        scheduledAt: r.scheduled_at,
        homeCollection: r.home_collection,
        total: r.total,
        paymentStatus: r.payment_status,
        createdAt: r.created_at,
        laboratory: { providerId: r.provider_id, nameAr: r.lab_name, slug: r.lab_slug },
        branchName: r.branch_name,
        patientName: r.patient_name,
        patientPhone: r.patient_phone,
        criticalCount: r.critical_count ?? undefined,
        itemsCount: r.items_count,
        itemsLabel: r.items_label,
      })),
      total,
      q,
    );
  }

  // ─────────────── Lab-side workflow ───────────────

  /** Loads an order for a lab action; foreign orders are reported as not found. */
  async forLab(user: AuthUser, id: string, perm: string, m: EntityManager) {
    const o = await m.findOne(LabOrder, { where: { id }, relations: { laboratory: true }, lock: { mode: 'pessimistic_write', tables: ['lab_orders'] } });
    if (!o || !user.providerIds.includes(o.laboratory!.providerId)) throw new NotFoundException('الطلب غير موجود');
    if (!user.permissions.has(perm)) throw new ForbiddenException('لا تملك صلاحية تنفيذ هذا الإجراء');
    return o;
  }

  private newBarcode() {
    let s = '';
    for (let i = 0; i < 10; i++) s += randomInt(10);
    return `L${s}`;
  }

  /** Creates one tube per sample type for tests that do not have an active sample yet. */
  private async ensureSamples(m: EntityManager, order: LabOrder, userId: string) {
    const full = await this.load(order.id, m);
    const tests = this.expandTests(full);
    const live = (full.samples ?? []).filter((s) => !s.rejectedAt);
    const now = new Date();
    // Pending tubes (e.g. replacements after rejection) are collected now.
    for (const s of live.filter((x) => !x.collectedAt)) {
      await m.update(LabSample, s.id, { collectedAt: now, collectedById: userId });
    }
    const haveTypes = new Set(live.map((s) => s.sampleType));
    const byType = new Map<string, string[]>();
    for (const t of tests) {
      const type = t.sampleType?.trim() || 'دم';
      if (haveTypes.has(type)) continue;
      byType.set(type, [...(byType.get(type) ?? []), t.code]);
    }
    for (const [type, codes] of byType) {
      let barcode = this.newBarcode();
      while (await m.exists(LabSample, { where: { barcode } })) barcode = this.newBarcode();
      await m.insert(LabSample, { orderId: order.id, barcode, sampleType: type, testsLabel: [...new Set(codes)].join(', '), collectedAt: now, collectedById: userId });
    }
  }

  private async notifyPatient(order: LabOrder, title: string, body: string, type: string, force = false) {
    const [row] = await this.ds.query(`SELECT user_id FROM patients WHERE id = $1`, [order.patientId]);
    if (row) await this.notifications.notify(row.user_id, { type, category: 'LAB_RESULTS', title, body, data: { labOrderId: order.id }, force });
  }

  async changeStatus(user: AuthUser, id: string, dto: LabStatusDto, meta: Meta = {}) {
    const res = await this.ds.transaction(async (m) => {
      const o = await this.forLab(user, id, P.LAB_ORDERS_MANAGE, m);
      const allowed = MANUAL_TRANSITIONS[o.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`لا يمكن نقل الطلب من "${LAB_STATUS_AR[o.status]}" إلى "${LAB_STATUS_AR[dto.status]}"`);
      }
      const patch: Partial<LabOrder> = { status: dto.status };
      if (dto.status === LabOrderStatus.PAID) Object.assign(patch, this.paymentPatch(dto.paymentMethod ?? PaymentMethod.CASH));
      if (dto.status === LabOrderStatus.SAMPLE_COLLECTED) await this.ensureSamples(m, o, user.id);
      if (dto.status === LabOrderStatus.SAMPLE_RECEIVED) {
        await m.query(`UPDATE lab_samples SET received_at = now() WHERE order_id = $1 AND rejected_at IS NULL AND received_at IS NULL`, [o.id]);
      }
      if (dto.status === LabOrderStatus.DELIVERED) patch.deliveredAt = new Date();
      await m.update(LabOrder, o.id, patch as any);
      if (dto.status === LabOrderStatus.PAID) await this.payments.recordOffline(m, 'LAB_ORDER', o.id, dto.paymentMethod ?? PaymentMethod.CASH, user.id);
      await this.history(m, o.id, o.status, dto.status, user.id, dto.note);
      await this.audit.log({ userId: user.id, action: 'LAB_ORDER_STATUS_CHANGED', entity: 'lab_orders', entityId: o.id, oldValue: { status: o.status }, newValue: { status: dto.status, note: dto.note }, ...meta }, m);
      return { ...o, ...patch } as LabOrder;
    });
    if (res.status === LabOrderStatus.SAMPLE_COLLECTED) {
      await this.notifyPatient(res, 'تم سحب العينة', `تم سحب عينة طلبك ${res.code}. سنبلغك فور جاهزية النتيجة.`, 'LAB_SAMPLE_COLLECTED');
    }
    await this.broadcast(res);
    return this.get(user, id);
  }

  private paymentPatch(method: PaymentMethod): Partial<LabOrder> {
    return { paymentStatus: PaymentStatus.PAID, paymentMethod: method, paidAt: new Date() };
  }

  /** Records payment at the counter. A NEW_ORDER moves to PAID; later stages keep their status. */
  async recordPayment(user: AuthUser, id: string, method: PaymentMethod, meta: Meta = {}) {
    const o = await this.ds.transaction(async (m) => {
      const o = await this.forLab(user, id, P.LAB_ORDERS_MANAGE, m);
      if (o.status === LabOrderStatus.CANCELLED) throw new BadRequestException('الطلب ملغي');
      if (o.paymentStatus === PaymentStatus.PAID) throw new ConflictException('تم تسجيل الدفع من قبل');
      const patch: Partial<LabOrder> = this.paymentPatch(method);
      if (o.status === LabOrderStatus.NEW_ORDER) {
        patch.status = LabOrderStatus.PAID;
        await this.history(m, o.id, o.status, LabOrderStatus.PAID, user.id, null);
      }
      await m.update(LabOrder, o.id, patch as any);
      await this.payments.recordOffline(m, 'LAB_ORDER', o.id, method, user.id);
      await this.audit.log({ userId: user.id, action: 'LAB_ORDER_PAID', entity: 'lab_orders', entityId: o.id, newValue: { method, total: o.total }, ...meta }, m);
      return { ...o, ...patch } as LabOrder;
    });
    await this.broadcast(o);
    return this.get(user, id);
  }

  async cancel(user: AuthUser, id: string, reason: string | undefined, meta: Meta = {}) {
    const res = await this.ds.transaction(async (m) => {
      const o = await m.findOne(LabOrder, { where: { id }, relations: { laboratory: { provider: true } }, lock: { mode: 'pessimistic_write', tables: ['lab_orders'] } });
      if (!o) throw new NotFoundException('الطلب غير موجود');
      const viewer = await this.viewerFor(user, o);
      if (viewer === 'PATIENT') {
        if (!PATIENT_CANCELLABLE.includes(o.status)) throw new BadRequestException('لا يمكن إلغاء الطلب بعد سحب العينة. تواصل مع المعمل.');
      } else if (viewer === 'LAB') {
        if (!user.permissions.has(P.LAB_ORDERS_MANAGE)) throw new ForbiddenException('لا تملك صلاحية إلغاء الطلبات');
        if (!LAB_CANCELLABLE.includes(o.status)) throw new BadRequestException('لا يمكن إلغاء طلب بعد إدخال نتائجه');
        if (!reason?.trim()) throw new BadRequestException('اكتب سبب الإلغاء للمريض');
      } else throw new NotFoundException('الطلب غير موجود');
      await m.update(LabOrder, o.id, { status: LabOrderStatus.CANCELLED, cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason?.trim() || null });
      await this.history(m, o.id, o.status, LabOrderStatus.CANCELLED, user.id, reason);
      await this.coupons.release(m, 'LAB_ORDER', o.id);
      await this.audit.log({ userId: user.id, action: 'LAB_ORDER_CANCELLED', entity: 'lab_orders', entityId: o.id, oldValue: { status: o.status }, newValue: { by: viewer, reason }, ...meta }, m);
      return { o, viewer };
    });
    const { o, viewer } = res;
    await this.payments.refundOnCancel('LAB_ORDER', o.id, `إلغاء طلب التحاليل ${o.code}`);
    const updated = { ...o, status: LabOrderStatus.CANCELLED };
    if (viewer === 'PATIENT') {
      await this.notifications.notifyMany(await this.teamUserIds(o.laboratory!.providerId), {
        type: 'LAB_ORDER_CANCELLED',
        category: 'LAB_RESULTS',
        title: 'إلغاء طلب تحاليل',
        body: `قام المريض بإلغاء الطلب ${o.code}${o.scheduledAt ? ` (${this.fmt(o.scheduledAt)})` : ''}.`,
        data: { labOrderId: o.id },
      });
    } else {
      await this.notifyPatient(o, 'تم إلغاء طلب التحاليل', `ألغى ${o.laboratory!.provider!.nameAr} طلبك ${o.code}. السبب: ${reason}`, 'LAB_ORDER_CANCELLED');
    }
    await this.broadcast(updated);
    return this.get(user, id);
  }

  /** Rejected tube → replacement tube is created and the order goes back for re-collection. */
  async rejectSample(user: AuthUser, orderId: string, sampleId: string, reason: string, meta: Meta = {}) {
    const o = await this.ds.transaction(async (m) => {
      const o = await this.forLab(user, orderId, P.LAB_ORDERS_MANAGE, m);
      if (![LabOrderStatus.SAMPLE_COLLECTED, LabOrderStatus.SAMPLE_RECEIVED, LabOrderStatus.PROCESSING].includes(o.status)) {
        throw new BadRequestException('لا يمكن رفض العينة في هذه المرحلة');
      }
      const s = await m.findOne(LabSample, { where: { id: sampleId, orderId } });
      if (!s || s.rejectedAt) throw new NotFoundException('العينة غير موجودة');
      await m.update(LabSample, s.id, { rejectedAt: new Date(), rejectedById: user.id, rejectReason: reason });
      let barcode = this.newBarcode();
      while (await m.exists(LabSample, { where: { barcode } })) barcode = this.newBarcode();
      await m.insert(LabSample, { orderId, barcode, sampleType: s.sampleType, testsLabel: s.testsLabel });
      const back = o.paymentStatus === PaymentStatus.PAID ? LabOrderStatus.PAID : LabOrderStatus.NEW_ORDER;
      await m.update(LabOrder, o.id, { status: back });
      await this.history(m, o.id, o.status, back, user.id, `رفض عينة ${s.barcode}: ${reason}`);
      await this.audit.log({ userId: user.id, action: 'LAB_SAMPLE_REJECTED', entity: 'lab_samples', entityId: s.id, newValue: { reason, orderId }, ...meta }, m);
      return { ...o, status: back } as LabOrder;
    });
    await this.notifyPatient(o, 'مطلوب إعادة سحب العينة', `نعتذر، عينة طلبك ${o.code} تحتاج إعادة سحب (${reason}). سيتواصل معك المعمل لتحديد الموعد.`, 'LAB_SAMPLE_REJECTED', true);
    await this.broadcast(o);
    return this.get(user, orderId);
  }
}
