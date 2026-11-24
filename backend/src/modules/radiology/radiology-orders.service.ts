import { CouponsService } from '../payments/coupons.service';
import { PaymentsService } from '../payments/payments.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  FileEntity,
  Patient,
  PaymentMethod,
  PaymentStatus,
  ProviderBranch,
  RadiologyBranchModality,
  RadiologyCenter,
  RadiologyOrder,
  RadiologyOrderFile,
  RadiologyOrderStatus as S,
  RadiologyOrderStatusHistory,
  RadiologyReport,
  RadiologyService,
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
import { ageInYears } from '../labs/lab-logic';
import { RadiologyCatalogService } from './radiology-catalog.service';
import { BookRadiologyDto, RadOrdersQuery, RadSlotsQuery, RadStatusDto, WorklistQuery } from './radiology.dto';
import {
  CENTER_CANCELLABLE,
  DICOM_MODALITY,
  MANUAL_TRANSITIONS,
  MODALITIES,
  OCCUPYING,
  PATIENT_CANCELLABLE,
  RAD_STATUS_AR,
  RELEASED,
  accessionNumber,
  buildExamSlots,
  dicomName,
  studyUidFrom,
} from './radiology-logic';

export type RadViewer = 'PATIENT' | 'CENTER' | 'PLATFORM';
interface Meta {
  ip?: string;
  userAgent?: string | null;
}
const CENTER_PERMS = [P.RADIOLOGY_ORDERS_MANAGE, P.RADIOLOGY_REPORTS_WRITE, P.RADIOLOGY_REPORTS_APPROVE, P.RADIOLOGY_CATALOG_MANAGE];

@Injectable()
export class RadiologyOrdersService {
  readonly tz: string;

  constructor(
    private ds: DataSource,
    config: ConfigService,
    private catalog: RadiologyCatalogService,
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

  async teamUserIds(providerId: string, m: EntityManager = this.ds.manager, adminsOnly = false): Promise<string[]> {
    const rows: { id: string }[] = await m.query(
      `SELECT owner_user_id AS id FROM providers WHERE id = $1
       UNION SELECT user_id FROM provider_staff WHERE provider_id = $1 AND is_active ${adminsOnly ? 'AND is_admin' : ''}`,
      [providerId],
    );
    return rows.map((r) => r.id);
  }

  async broadcast(order: { id: string; status: S; patientId: string; centerId: string }) {
    const [row] = await this.ds.query(`SELECT pa.user_id, c.provider_id FROM patients pa, radiology_centers c WHERE pa.id = $1 AND c.id = $2`, [order.patientId, order.centerId]);
    if (!row) return;
    const team = await this.teamUserIds(row.provider_id);
    this.gateway.emitToUsers([...team, row.user_id], 'radiology:order', { id: order.id, status: order.status });
  }

  async history(m: EntityManager, orderId: string, from: S | null, to: S, by: string | null, note?: string | null) {
    await m.insert(RadiologyOrderStatusHistory, { orderId, fromStatus: from, toStatus: to, changedById: by, note: note ?? null });
  }

  async notifyPatient(order: { id: string; patientId: string }, title: string, body: string, type: string, force = false) {
    const [row] = await this.ds.query(`SELECT user_id FROM patients WHERE id = $1`, [order.patientId]);
    if (row) await this.notifications.notify(row.user_id, { type, category: 'RADIOLOGY', title, body, data: { radiologyOrderId: order.id }, force });
  }

  // ─────────────── Availability ───────────────

  private async slotsFor(m: EntityManager, center: RadiologyCenter, service: RadiologyService, branch: ProviderBranch, date: string, ignoreOrderId?: string) {
    const day = DateTime.fromISO(date, { zone: this.tz });
    if (!day.isValid) throw new BadRequestException('تاريخ غير صحيح');
    const unit = await m.findOne(RadiologyBranchModality, { where: { branchId: branch.id, modality: service.modality } });
    const busy: { start_at: Date; end_at: Date }[] = await m.query(
      `SELECT scheduled_at AS start_at, end_at FROM radiology_orders
        WHERE branch_id = $1 AND modality = $2 AND status = ANY($3::radiology_order_status[])
          AND scheduled_at < $5 AND end_at > $4 ${ignoreOrderId ? 'AND id <> $6' : ''}`,
      [branch.id, service.modality, OCCUPYING, day.startOf('day').toJSDate(), day.endOf('day').toJSDate(), ...(ignoreOrderId ? [ignoreOrderId] : [])],
    );
    return buildExamSlots({
      hours: branch.openingHours,
      date,
      tz: this.tz,
      stepMinutes: center.slotStepMinutes,
      durationMinutes: service.durationMinutes,
      units: unit?.units ?? 0,
      busy: busy.map((b) => ({ start: new Date(b.start_at), end: new Date(b.end_at) })),
      now: new Date(),
      minLeadMinutes: await this.settings.get<number>('booking.minLeadMinutes'),
      horizonDays: center.bookingHorizonDays,
    });
  }

  async slots(key: string, q: RadSlotsQuery) {
    const center = await this.catalog.publicCenter(key);
    const service = await this.ds.getRepository(RadiologyService).findOneBy({ id: q.serviceId, centerId: center.id, isActive: true });
    if (!service) throw new NotFoundException('الخدمة غير موجودة');
    const branch = await this.ds.getRepository(ProviderBranch).findOneBy({ id: q.branchId, providerId: center.providerId, isActive: true });
    if (!branch) throw new NotFoundException('الفرع غير موجود');
    return { date: q.date, timezone: this.tz, durationMinutes: service.durationMinutes, slots: await this.slotsFor(this.ds.manager, center, service, branch, q.date) };
  }

  // ─────────────── Booking ───────────────

  async book(user: AuthUser, dto: BookRadiologyDto, meta: Meta = {}) {
    const patientId = user.patientId;
    if (!patientId) throw new ForbiddenException('يجب أن يكون لديك ملف مريض لحجز الأشعة');
    const scheduledAt = new Date(dto.scheduledAt);
    if (isNaN(scheduledAt.getTime())) throw new BadRequestException('موعد غير صحيح');
    const maxActive = await this.settings.get<number>('radiology.maxActiveOrdersPerPatient');

    const res = await this.ds.transaction(async (m) => {
      const service = await m.findOne(RadiologyService, { where: { id: dto.serviceId, isActive: true } });
      if (!service) throw new BadRequestException('الخدمة غير متاحة');
      // One booking at a time per center: capacity is re-counted under the lock.
      await m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 78))`, [`rad:${service.centerId}`]);
      const center = await m.findOne(RadiologyCenter, { where: { id: service.centerId }, relations: { provider: { owner: true } } });
      const provider = center?.provider;
      if (!center || !provider || provider.verificationStatus !== VerificationStatus.APPROVED || !provider.isActive || !provider.subscriptionActive || provider.owner?.status !== 'ACTIVE') {
        throw new BadRequestException('هذا المركز غير متاح للحجز حالياً');
      }
      if ((await this.teamUserIds(provider.id, m)).includes(user.id)) throw new BadRequestException('لا يمكنك الحجز في المركز الذي تعمل به');
      const patient = await m.findOne(Patient, { where: { id: patientId }, relations: { user: true } });
      if (!patient || patient.user?.status !== 'ACTIVE') throw new BadRequestException('حساب المريض غير مفعل');
      const branch = await m.findOne(ProviderBranch, { where: { id: dto.branchId, providerId: provider.id, isActive: true } });
      if (!branch) throw new BadRequestException('الفرع المختار غير متاح');

      if (dto.referralFileId) {
        const f = await m.findOne(FileEntity, { where: { id: dto.referralFileId, purpose: 'REFERRAL' } });
        if (!f || f.uploadedById !== user.id) throw new BadRequestException('ملف التحويل غير صالح');
      } else if (service.requiresReferral) {
        throw new BadRequestException('هذا الفحص يتطلب رفع خطاب تحويل من الطبيب');
      }

      const localDate = DateTime.fromJSDate(scheduledAt).setZone(this.tz).toISODate()!;
      const slots = await this.slotsFor(m, center, service, branch, localDate);
      const slot = slots.find((s) => s.startAt === scheduledAt.toISOString());
      if (!slot) throw new BadRequestException({ message: 'الموعد المختار غير متاح', code: 'INVALID_SLOT' });
      if (slot.remaining < 1) throw new ConflictException({ message: 'هذا الموعد اكتمل، من فضلك اختر موعداً آخر', code: 'SLOT_FULL' });

      const active = await m.count(RadiologyOrder, { where: { patientId, status: In(OCCUPYING) } });
      if (active >= maxActive) throw new BadRequestException(`لا يمكن أن يكون لديك أكثر من ${maxActive} حجوزات أشعة مفتوحة`);
      const endAt = new Date(slot.endAt);
      const [clash] = await m.query(
        `SELECT 1 FROM radiology_orders WHERE patient_id = $1 AND status = ANY($2::radiology_order_status[]) AND scheduled_at < $4 AND end_at > $3 LIMIT 1`,
        [patientId, OCCUPYING, scheduledAt, endAt],
      );
      if (clash) throw new ConflictException({ message: 'لديك حجز أشعة آخر في نفس الوقت', code: 'PATIENT_CONFLICT' });

      let contactPhone: string | null = null;
      if (dto.contactPhone) {
        contactPhone = normalizePhone(dto.contactPhone);
        if (!contactPhone) throw new BadRequestException('رقم التواصل غير صحيح');
      }
      const o = await m.save(
        m.create(RadiologyOrder, {
          code: humanCode('RAD'),
          centerId: center.id,
          serviceId: service.id,
          patientId,
          branchId: branch.id,
          scheduledAt,
          endAt,
          modality: service.modality,
          status: S.BOOKED,
          price: service.price,
          paymentStatus: PaymentStatus.PENDING,
          referralFileId: dto.referralFileId ?? null,
          clinicalIndication: dto.clinicalIndication?.trim() || null,
          referringDoctor: dto.referringDoctor?.trim() || null,
          contactPhone,
          createdById: user.id,
        }),
      );
      if (dto.couponCode?.trim()) {
        const c = await this.coupons.redeem(m, { code: dto.couponCode, entityType: 'RADIOLOGY_ORDER', entityId: o.id, providerId: provider.id, amount: Number(service.price), patientId });
        o.discount = c.discount;
        await m.update(RadiologyOrder, o.id, { discount: c.discount, couponId: c.couponId });
      }
      await this.history(m, o.id, null, S.BOOKED, user.id);
      await this.audit.log({ userId: user.id, action: 'RADIOLOGY_BOOKED', entity: 'radiology_orders', entityId: o.id, newValue: { code: o.code, serviceId: service.id, scheduledAt, price: o.price }, ...meta }, m);
      return { o, providerId: provider.id, centerName: provider.nameAr, serviceName: service.name, branchName: branch.name, prep: service.preparationInstructions };
    });

    const { o } = res;
    const when = this.fmt(o.scheduledAt);
    await this.notifications.notify(user.id, {
      type: 'RADIOLOGY_BOOKED',
      category: 'RADIOLOGY',
      title: 'تم تأكيد حجز الأشعة',
      body: `${res.serviceName} — ${res.centerName} (${res.branchName}) يوم ${when}. رقم الحجز ${o.code}.${res.prep ? ` التحضير: ${res.prep}` : ''}`,
      data: { radiologyOrderId: o.id },
    });
    await this.notifications.notifyMany(await this.teamUserIds(res.providerId), {
      type: 'RADIOLOGY_NEW',
      category: 'RADIOLOGY',
      title: 'حجز أشعة جديد',
      body: `${o.code} — ${res.serviceName} — ${user.fullName} — ${when}`,
      data: { radiologyOrderId: o.id },
    });
    await this.broadcast(o);
    return this.get(user, o.id);
  }

  // ─────────────── Reading ───────────────

  async viewerFor(user: AuthUser, o: { patientId: string; center?: { providerId: string } | null }): Promise<RadViewer> {
    if (user.patientId && o.patientId === user.patientId) return 'PATIENT';
    if (o.center && user.providerIds.includes(o.center.providerId) && CENTER_PERMS.some((p) => user.permissions.has(p))) return 'CENTER';
    if (user.permissions.has(P.RADIOLOGY_ORDERS_READ_ANY)) return 'PLATFORM';
    throw new NotFoundException('الحجز غير موجود');
  }

  async load(id: string, m: EntityManager = this.ds.manager) {
    const o = await m.findOne(RadiologyOrder, { where: { id }, relations: { center: { provider: true }, service: true, branch: true, patient: { user: true } } });
    if (!o) throw new NotFoundException('الحجز غير موجود');
    return o;
  }

  capabilities(user: AuthUser, viewer: RadViewer, o: RadiologyOrder, report: RadiologyReport | null) {
    const has = (p: string) => user.permissions.has(p);
    const c = viewer === 'CENTER';
    return {
      transitions: c && has(P.RADIOLOGY_ORDERS_MANAGE) ? MANUAL_TRANSITIONS[o.status] ?? [] : [],
      recordPayment: c && has(P.RADIOLOGY_ORDERS_MANAGE) && o.paymentStatus !== PaymentStatus.PAID && ![S.CANCELLED, S.NO_SHOW].includes(o.status),
      cancel: (viewer === 'PATIENT' && PATIENT_CANCELLABLE.includes(o.status)) || (c && has(P.RADIOLOGY_ORDERS_MANAGE) && CENTER_CANCELLABLE.includes(o.status)),
      writeReport: c && has(P.RADIOLOGY_REPORTS_WRITE) && o.status === S.REPORTING && !report?.submittedAt,
      submitReport: c && has(P.RADIOLOGY_REPORTS_WRITE) && o.status === S.REPORTING && !!report && !report.submittedAt,
      returnReport: c && has(P.RADIOLOGY_REPORTS_APPROVE) && o.status === S.REPORTING && !!report?.submittedAt,
      approve:
        c &&
        has(P.RADIOLOGY_REPORTS_APPROVE) &&
        o.status === S.REPORTING &&
        !!report?.submittedAt &&
        !(o.center?.requireSeparateApprover && report?.reportedById === user.id),
      attachImages: c && has(P.RADIOLOGY_REPORTS_WRITE) && [S.EXAMINATION, S.REPORTING].includes(o.status),
      editPacs: c && (has(P.RADIOLOGY_ORDERS_MANAGE) || has(P.RADIOLOGY_REPORTS_WRITE)) && !!o.accessionNumber,
      viewReport: c ? !!report : viewer === 'PATIENT' && RELEASED.includes(o.status),
      downloadReport: viewer !== 'PLATFORM' && RELEASED.includes(o.status),
      previewReport: c && !!report && o.status === S.REPORTING,
      viewReferral: viewer !== 'PLATFORM' && !!o.referralFileId,
      chat: viewer !== 'PLATFORM',
    };
  }

  async get(user: AuthUser, id: string) {
    const o = await this.load(id);
    const viewer = await this.viewerFor(user, o);
    const report = await this.ds.getRepository(RadiologyReport).findOne({ where: { orderId: id } });
    const history = await this.ds.query(
      `SELECT h.from_status, h.to_status, h.note, h.created_at, u.full_name AS by_name
         FROM radiology_order_status_history h LEFT JOIN users u ON u.id = h.changed_by_id
        WHERE h.order_id = $1 ORDER BY h.created_at ASC`,
      [id],
    );
    const p = o.center!.provider!;
    const platform = viewer === 'PLATFORM';
    const released = RELEASED.includes(o.status);
    const base = {
      id: o.id,
      code: o.code,
      status: o.status,
      statusLabel: RAD_STATUS_AR[o.status],
      scheduledAt: o.scheduledAt,
      endAt: o.endAt,
      modality: o.modality,
      modalityLabel: MODALITIES[o.modality] ?? o.modality,
      price: o.price,
      discount: Number(o.discount),
      total: Math.round((Number(o.price) - Number(o.discount)) * 100) / 100,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      paidAt: o.paidAt,
      checkedInAt: o.checkedInAt,
      examStartedAt: o.examStartedAt,
      examCompletedAt: o.examCompletedAt,
      cancelledAt: o.cancelledAt,
      cancelReason: o.cancelReason,
      deliveredAt: o.deliveredAt,
      createdAt: o.createdAt,
      center: { id: o.centerId, providerId: p.id, nameAr: p.nameAr, slug: p.slug, phone: p.phone, whatsappNumber: p.whatsappNumber },
      branch: o.branch ? { id: o.branch.id, name: o.branch.name, address: o.branch.address, phone: o.branch.phone } : null,
      service: { id: o.service!.id, name: o.service!.name, durationMinutes: o.service!.durationMinutes, preparationInstructions: o.service!.preparationInstructions },
      history,
      viewer,
      can: this.capabilities(user, viewer, o, report),
    };
    if (platform) return { ...base, patient: { fullName: o.patient?.user?.fullName } };
    const pu = o.patient!;
    const files = await this.ds.query(
      `SELECT rf.id, rf.file_id, rf.caption, rf.created_at, f.mime_type, f.original_name FROM radiology_order_files rf JOIN files f ON f.id = rf.file_id WHERE rf.order_id = $1 ORDER BY rf.created_at`,
      [id],
    );
    return {
      ...base,
      clinicalIndication: o.clinicalIndication,
      referringDoctor: o.referringDoctor,
      contactPhone: o.contactPhone,
      referralFileId: o.referralFileId,
      accessionNumber: viewer === 'CENTER' ? o.accessionNumber : null,
      studyInstanceUid: viewer === 'CENTER' ? o.studyInstanceUid : null,
      pacsUrl: viewer === 'CENTER' || released ? o.pacsUrl : null,
      patient:
        viewer === 'CENTER'
          ? { id: pu.id, userId: pu.userId, fullName: pu.user?.fullName, phone: pu.user?.phone, gender: pu.gender, ageYears: ageInYears(pu.dateOfBirth, o.createdAt) }
          : { id: pu.id, fullName: pu.user?.fullName },
      images: viewer === 'CENTER' || released ? files.map((f: any) => ({ id: f.id, fileId: f.file_id, caption: f.caption, mimeType: f.mime_type, name: f.original_name, createdAt: f.created_at })) : [],
      report:
        report && (viewer === 'CENTER' || released)
          ? {
              id: report.id,
              technique: report.technique,
              comparison: report.comparison,
              findings: report.findings,
              impression: report.impression,
              recommendations: report.recommendations,
              critical: report.critical,
              submittedAt: report.submittedAt,
              returnNote: viewer === 'CENTER' ? report.returnNote : null,
              reportedAt: report.reportedAt,
              approvedAt: report.approvedAt,
              reportedById: viewer === 'CENTER' ? report.reportedById : undefined,
              verificationCode: released ? report.verificationCode : null,
              names: await this.names([report.reportedById, report.approvedById]),
            }
          : null,
      reportTemplate: viewer === 'CENTER' ? o.service!.reportTemplate : undefined,
    };
  }

  async names(ids: (string | null)[]) {
    const list = ids.filter(Boolean) as string[];
    if (!list.length) return {};
    const rows: { id: string; full_name: string }[] = await this.ds.query(`SELECT id, full_name FROM users WHERE id = ANY($1::uuid[])`, [list]);
    return Object.fromEntries(rows.map((r) => [r.id, r.full_name]));
  }

  async list(user: AuthUser, scope: 'patient' | 'center' | 'admin', q: RadOrdersQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.split('?').join(`$${params.length}`));
    };
    if (scope === 'patient') {
      if (!user.patientId) return paginate([], 0, q);
      add('o.patient_id = ?', user.patientId);
    } else if (scope === 'center') {
      const { center } = await this.catalog.myCenter(user);
      add('o.center_id = ?', center.id);
      if (q.branchId) add('o.branch_id = ?', q.branchId);
    } else if (q.centerId) add('o.center_id = ?', q.centerId);
    if (q.status) {
      const st = q.status.split(',').filter((s) => (Object.values(S) as string[]).includes(s));
      if (st.length) add('o.status = ANY(?::radiology_order_status[])', st);
    }
    if (q.modality) add('o.modality = ?', q.modality);
    if (q.from) add('o.scheduled_at >= ?', new Date(q.from));
    if (q.to) add('o.scheduled_at <= ?', new Date(q.to));
    if (q.search) {
      const s = `%${likeEscape(q.search)}%`;
      if (scope === 'patient') add('(o.code ILIKE ? OR pr.name_ar ILIKE ? OR sv.name ILIKE ?)', s);
      else add('(o.code ILIKE ? OR o.accession_number ILIKE ? OR u.full_name ILIKE ? OR u.phone ILIKE ? OR sv.name ILIKE ?)', s);
    }
    const from = `FROM radiology_orders o
      JOIN radiology_centers c ON c.id = o.center_id JOIN providers pr ON pr.id = c.provider_id
      JOIN radiology_services sv ON sv.id = o.service_id
      JOIN patients pa ON pa.id = o.patient_id JOIN users u ON u.id = pa.user_id
      LEFT JOIN provider_branches b ON b.id = o.branch_id
      LEFT JOIN radiology_reports r ON r.order_id = o.id`;
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total ${from} ${cond}`, params);
    const { skip, take } = skipTake(q);
    const dir = q.sortDir?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const rows = await this.ds.query(
      `SELECT o.id, o.code, o.status, o.scheduled_at, o.end_at, o.modality, o.price::float AS price, o.payment_status, o.created_at,
              sv.name AS service_name, pr.name_ar AS center_name, pr.slug AS center_slug, pr.id AS provider_id, b.name AS branch_name,
              u.full_name AS patient_name ${scope === 'center' ? ', u.phone AS patient_phone, o.accession_number, r.critical, r.submitted_at IS NOT NULL AS report_submitted' : ''}
         ${from} ${cond} ORDER BY ${scope === 'patient' ? 'o.created_at' : 'o.scheduled_at'} ${dir} LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paginate(
      rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        scheduledAt: r.scheduled_at,
        endAt: r.end_at,
        modality: r.modality,
        modalityLabel: MODALITIES[r.modality] ?? r.modality,
        serviceName: r.service_name,
        price: r.price,
        paymentStatus: r.payment_status,
        createdAt: r.created_at,
        center: { providerId: r.provider_id, nameAr: r.center_name, slug: r.center_slug },
        branchName: r.branch_name,
        patientName: r.patient_name,
        patientPhone: r.patient_phone,
        accessionNumber: r.accession_number,
        critical: r.critical ?? undefined,
        reportSubmitted: r.report_submitted ?? undefined,
      })),
      total,
      q,
    );
  }

  // ─────────────── Center workflow ───────────────

  async forCenter(user: AuthUser, id: string, perm: string, m: EntityManager) {
    const o = await m.findOne(RadiologyOrder, { where: { id }, relations: { center: true }, lock: { mode: 'pessimistic_write', tables: ['radiology_orders'] } });
    if (!o || !user.providerIds.includes(o.center!.providerId)) throw new NotFoundException('الحجز غير موجود');
    if (!user.permissions.has(perm)) throw new ForbiddenException('لا تملك صلاحية تنفيذ هذا الإجراء');
    return o;
  }

  async changeStatus(user: AuthUser, id: string, dto: RadStatusDto, meta: Meta = {}) {
    const o = await this.ds.transaction(async (m) => {
      const o = await this.forCenter(user, id, P.RADIOLOGY_ORDERS_MANAGE, m);
      if (!(MANUAL_TRANSITIONS[o.status] ?? []).includes(dto.status)) {
        throw new BadRequestException(`لا يمكن نقل الحجز من "${RAD_STATUS_AR[o.status]}" إلى "${RAD_STATUS_AR[dto.status]}"`);
      }
      const now = new Date();
      const patch: Record<string, unknown> = { status: dto.status };
      if (dto.status === S.CHECKED_IN) {
        patch.checkedInAt = now;
        // DICOM identifiers are issued at arrival so the modality worklist can pick the patient up.
        patch.accessionNumber = o.accessionNumber ?? accessionNumber(o.id, now);
        patch.studyInstanceUid = o.studyInstanceUid ?? studyUidFrom(o.id);
      }
      if (dto.status === S.EXAMINATION) Object.assign(patch, { examStartedAt: now, technicianId: user.id });
      if (dto.status === S.REPORTING) patch.examCompletedAt = now;
      if (dto.status === S.DELIVERED) patch.deliveredAt = now;
      await m.update(RadiologyOrder, o.id, patch);
      await this.history(m, o.id, o.status, dto.status, user.id, dto.note);
      await this.audit.log({ userId: user.id, action: 'RADIOLOGY_STATUS_CHANGED', entity: 'radiology_orders', entityId: o.id, oldValue: { status: o.status }, newValue: { status: dto.status, note: dto.note }, ...meta }, m);
      return { ...o, ...patch } as RadiologyOrder;
    });
    if (o.status === S.NO_SHOW) await this.notifyPatient(o, 'فاتك موعد الأشعة', `تم تسجيل عدم الحضور لحجز ${o.code}. يمكنك حجز موعد جديد في أي وقت.`, 'RADIOLOGY_NO_SHOW');
    await this.broadcast(o);
    return this.get(user, id);
  }

  async recordPayment(user: AuthUser, id: string, method: PaymentMethod, meta: Meta = {}) {
    const o = await this.ds.transaction(async (m) => {
      const o = await this.forCenter(user, id, P.RADIOLOGY_ORDERS_MANAGE, m);
      if ([S.CANCELLED, S.NO_SHOW].includes(o.status)) throw new BadRequestException('الحجز ملغي');
      if (o.paymentStatus === PaymentStatus.PAID) throw new ConflictException('تم تسجيل الدفع من قبل');
      await m.update(RadiologyOrder, o.id, { paymentStatus: PaymentStatus.PAID, paymentMethod: method, paidAt: new Date() });
      await this.payments.recordOffline(m, 'RADIOLOGY_ORDER', o.id, method, user.id);
      await this.audit.log({ userId: user.id, action: 'RADIOLOGY_PAID', entity: 'radiology_orders', entityId: o.id, newValue: { method, price: o.price }, ...meta }, m);
      return o;
    });
    await this.broadcast(o);
    return this.get(user, id);
  }

  async cancel(user: AuthUser, id: string, reason: string | undefined, meta: Meta = {}) {
    const { o, viewer } = await this.ds.transaction(async (m) => {
      const o = await m.findOne(RadiologyOrder, { where: { id }, relations: { center: { provider: true } }, lock: { mode: 'pessimistic_write', tables: ['radiology_orders'] } });
      if (!o) throw new NotFoundException('الحجز غير موجود');
      const viewer = await this.viewerFor(user, o);
      if (viewer === 'PATIENT') {
        if (!PATIENT_CANCELLABLE.includes(o.status)) throw new BadRequestException('لا يمكن إلغاء الحجز بعد الحضور. تواصل مع المركز.');
      } else if (viewer === 'CENTER') {
        if (!user.permissions.has(P.RADIOLOGY_ORDERS_MANAGE)) throw new ForbiddenException('لا تملك صلاحية إلغاء الحجوزات');
        if (!CENTER_CANCELLABLE.includes(o.status)) throw new BadRequestException('لا يمكن إلغاء حجز بعد بدء الفحص');
        if (!reason?.trim()) throw new BadRequestException('اكتب سبب الإلغاء للمريض');
      } else throw new NotFoundException('الحجز غير موجود');
      await m.update(RadiologyOrder, o.id, { status: S.CANCELLED, cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason?.trim() || null });
      await this.history(m, o.id, o.status, S.CANCELLED, user.id, reason);
      await this.coupons.release(m, 'RADIOLOGY_ORDER', o.id);
      await this.audit.log({ userId: user.id, action: 'RADIOLOGY_CANCELLED', entity: 'radiology_orders', entityId: o.id, oldValue: { status: o.status }, newValue: { by: viewer, reason }, ...meta }, m);
      return { o, viewer };
    });
    await this.payments.refundOnCancel('RADIOLOGY_ORDER', o.id, `إلغاء حجز الأشعة ${o.code}`);
    if (viewer === 'PATIENT') {
      await this.notifications.notifyMany(await this.teamUserIds(o.center!.providerId), {
        type: 'RADIOLOGY_CANCELLED',
        category: 'RADIOLOGY',
        title: 'إلغاء حجز أشعة',
        body: `قام المريض بإلغاء الحجز ${o.code} (${this.fmt(o.scheduledAt)}).`,
        data: { radiologyOrderId: o.id },
      });
    } else {
      await this.notifyPatient(o, 'تم إلغاء حجز الأشعة', `ألغى ${o.center!.provider!.nameAr} حجزك ${o.code}. السبب: ${reason}`, 'RADIOLOGY_CANCELLED');
    }
    await this.broadcast({ ...o, status: S.CANCELLED });
    return this.get(user, id);
  }

  // ─────────────── Images & PACS ───────────────

  async attachFile(user: AuthUser, id: string, fileId: string, caption: string | undefined) {
    await this.ds.transaction(async (m) => {
      const o = await this.forCenter(user, id, P.RADIOLOGY_REPORTS_WRITE, m);
      if (![S.EXAMINATION, S.REPORTING].includes(o.status)) throw new BadRequestException('يمكن إرفاق الصور أثناء الفحص أو كتابة التقرير فقط');
      const f = await m.findOne(FileEntity, { where: { id: fileId, purpose: 'RADIOLOGY_IMAGE' } });
      if (!f || f.uploadedById !== user.id) throw new BadRequestException('الملف غير صالح');
      if (await m.exists(RadiologyOrderFile, { where: { fileId } })) throw new ConflictException('الملف مرفق بالفعل');
      if ((await m.count(RadiologyOrderFile, { where: { orderId: id } })) >= 20) throw new BadRequestException('الحد الأقصى 20 ملف لكل فحص');
      await m.insert(RadiologyOrderFile, { orderId: id, fileId, caption: caption?.trim() || null, uploadedById: user.id });
      await this.audit.log({ userId: user.id, action: 'RADIOLOGY_IMAGE_ATTACHED', entity: 'radiology_orders', entityId: id, newValue: { fileId } }, m);
    });
    return this.get(user, id);
  }

  async removeFile(user: AuthUser, id: string, attachmentId: string) {
    await this.ds.transaction(async (m) => {
      const o = await this.forCenter(user, id, P.RADIOLOGY_REPORTS_WRITE, m);
      if (RELEASED.includes(o.status)) throw new BadRequestException('لا يمكن حذف صور بعد اعتماد التقرير');
      const res = await m.delete(RadiologyOrderFile, { id: attachmentId, orderId: id });
      if (!res.affected) throw new NotFoundException('المرفق غير موجود');
    });
    return this.get(user, id);
  }

  async setPacs(user: AuthUser, id: string, pacsUrl: string | null | undefined) {
    await this.ds.transaction(async (m) => {
      const o = await this.forCenter(user, id, P.RADIOLOGY_REPORTS_WRITE, m);
      if (!o.accessionNumber) throw new BadRequestException('سجّل حضور المريض أولاً');
      await m.update(RadiologyOrder, id, { pacsUrl: pacsUrl || null });
      await this.audit.log({ userId: user.id, action: 'RADIOLOGY_PACS_LINKED', entity: 'radiology_orders', entityId: id, newValue: { pacsUrl } }, m);
    });
    return this.get(user, id);
  }

  /**
   * DICOM Modality Worklist feed (JSON, attribute names per PS3.4 MWL). A PACS/RIS
   * bridge (e.g. an Orthanc plugin or HL7 ORM gateway) can poll this to pre-fill
   * patient and procedure data on the scanner — no PACS is implemented here.
   */
  async worklist(user: AuthUser, q: WorklistQuery) {
    const { center } = await this.catalog.myCenter(user);
    const date = q.date ?? DateTime.now().setZone(this.tz).toISODate()!;
    const day = DateTime.fromISO(date, { zone: this.tz });
    const params: unknown[] = [center.id, day.startOf('day').toJSDate(), day.endOf('day').toJSDate()];
    let extra = '';
    if (q.modality) (params.push(q.modality), (extra += ` AND o.modality = $${params.length}`));
    if (q.branchId) (params.push(q.branchId), (extra += ` AND o.branch_id = $${params.length}`));
    const rows = await this.ds.query(
      `SELECT o.*, sv.name AS service_name, u.full_name, pa.gender, to_char(pa.date_of_birth, 'YYYYMMDD') AS dob, b.name AS branch_name
         FROM radiology_orders o JOIN radiology_services sv ON sv.id = o.service_id
         JOIN patients pa ON pa.id = o.patient_id JOIN users u ON u.id = pa.user_id LEFT JOIN provider_branches b ON b.id = o.branch_id
        WHERE o.center_id = $1 AND o.scheduled_at BETWEEN $2 AND $3 AND o.status IN ('BOOKED','CHECKED_IN','EXAMINATION') ${extra}
        ORDER BY o.scheduled_at`,
      params,
    );
    const d = (x: Date) => DateTime.fromJSDate(new Date(x)).setZone(this.tz);
    return rows.map((r: any) => ({
      AccessionNumber: r.accession_number,
      StudyInstanceUID: r.study_instance_uid,
      PatientName: dicomName(r.full_name),
      PatientID: r.patient_id,
      PatientBirthDate: r.dob ?? '',
      PatientSex: r.gender === 'MALE' ? 'M' : r.gender === 'FEMALE' ? 'F' : 'O',
      RequestedProcedureDescription: r.service_name,
      ReferringPhysicianName: r.referring_doctor ?? '',
      ScheduledProcedureStepSequence: [
        {
          Modality: DICOM_MODALITY[r.modality] ?? 'OT',
          ScheduledProcedureStepStartDate: d(r.scheduled_at).toFormat('yyyyLLdd'),
          ScheduledProcedureStepStartTime: d(r.scheduled_at).toFormat('HHmmss'),
          ScheduledStationName: r.branch_name ?? '',
          ScheduledProcedureStepDescription: r.service_name,
          ScheduledProcedureStepID: r.code,
        },
      ],
      _status: r.status,
      _orderId: r.id,
    }));
  }

  /** Referral & image files: readable by the patient (owner) and the center team of that booking. */
  async canReadFile(user: AuthUser, fileId: string) {
    const [row] = await this.ds.query(
      `SELECT o.patient_id, o.status, c.provider_id, (o.referral_file_id = $1) AS is_referral
         FROM radiology_orders o JOIN radiology_centers c ON c.id = o.center_id
        WHERE o.referral_file_id = $1 OR EXISTS (SELECT 1 FROM radiology_order_files f WHERE f.order_id = o.id AND f.file_id = $1)
        LIMIT 1`,
      [fileId],
    );
    if (!row) return false;
    if (user.providerIds.includes(row.provider_id)) return true;
    if (user.patientId === row.patient_id) return row.is_referral || RELEASED.includes(row.status);
    return false;
  }
}
