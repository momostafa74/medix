import { CouponsService } from '../payments/coupons.service';
import { PaymentsService } from '../payments/payments.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { Brackets, DataSource, EntityManager, In, IsNull, LessThan, MoreThan, QueryFailedError } from 'typeorm';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  Appointment,
  AppointmentStatus,
  AppointmentStatusHistory,
  AppointmentType,
  Doctor,
  DoctorSpecialty,
  Patient,
  PaymentMethod,
  PaymentStatus,
} from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { likeEscape, paginate, skipTake } from '../../common/dto/pagination.dto';
import { humanCode } from '../../common/utils/codes';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { AvailabilityService } from '../schedules/availability.service';
import { BookAppointmentDto, ListAppointmentsQuery, RescheduleDto, UpdateStatusDto } from './appointments.dto';

/** Allowed provider-driven transitions. Cancellation/rescheduling have dedicated flows. */
export const TRANSITIONS: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  [AppointmentStatus.PENDING]: [AppointmentStatus.CONFIRMED],
  [AppointmentStatus.CONFIRMED]: [AppointmentStatus.CHECKED_IN, AppointmentStatus.NO_SHOW, AppointmentStatus.COMPLETED],
  [AppointmentStatus.CHECKED_IN]: [AppointmentStatus.IN_PROGRESS, AppointmentStatus.COMPLETED],
  [AppointmentStatus.IN_PROGRESS]: [AppointmentStatus.COMPLETED],
};

const CANCELLABLE = [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED];

const STATUS_AR: Record<AppointmentStatus, string> = {
  PENDING: 'قيد التأكيد',
  CONFIRMED: 'مؤكد',
  CHECKED_IN: 'تم الحضور',
  IN_PROGRESS: 'جاري الكشف',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغي',
  NO_SHOW: 'لم يحضر',
  RESCHEDULED: 'تم تغيير الموعد',
};

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private ds: DataSource,
    private availability: AvailabilityService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private settings: SettingsService,
    private coupons: CouponsService,
    private payments: PaymentsService,
  ) {}

  private fmt(d: Date) {
    return DateTime.fromJSDate(d).setZone(this.availability.tz).setLocale('ar-EG').toFormat('cccc d LLLL yyyy - h:mm a');
  }

  /**
   * Serialises all bookings for one doctor inside the current transaction.
   * Combined with the `appointment_no_overlap` exclusion constraint this makes
   * double booking impossible even under concurrent requests.
   */
  private lockDoctor(m: EntityManager, doctorId: string) {
    return m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 42))`, [doctorId]);
  }

  private async assertNoOverlap(m: EntityManager, doctorId: string, patientId: string, startAt: Date, endAt: Date, ignoreId?: string) {
    const params: unknown[] = [doctorId, startAt, endAt, ACTIVE_APPOINTMENT_STATUSES];
    const ignore = ignoreId ? `AND id <> $5` : '';
    if (ignoreId) params.push(ignoreId);
    const [busy] = await m.query(
      `SELECT 1 FROM appointments WHERE doctor_id = $1 AND status = ANY($4::appointment_status[])
          AND tstzrange(start_at, end_at, '[)') && tstzrange($2, $3, '[)') ${ignore} LIMIT 1`,
      params,
    );
    if (busy) throw new ConflictException({ message: 'هذا الموعد محجوز بالفعل، من فضلك اختر موعداً آخر', code: 'SLOT_UNAVAILABLE' });

    const pParams: unknown[] = [patientId, startAt, endAt, ACTIVE_APPOINTMENT_STATUSES];
    if (ignoreId) pParams.push(ignoreId);
    const [mine] = await m.query(
      `SELECT 1 FROM appointments WHERE patient_id = $1 AND status = ANY($4::appointment_status[])
          AND tstzrange(start_at, end_at, '[)') && tstzrange($2, $3, '[)') ${ignore} LIMIT 1`,
      pParams,
    );
    if (mine) throw new ConflictException({ message: 'لديك موعد آخر في نفس الوقت', code: 'PATIENT_CONFLICT' });
  }

  private priceFor(d: Doctor, type: AppointmentType) {
    if (type === AppointmentType.ONLINE) return d.onlinePrice ?? d.consultationPrice;
    if (type === AppointmentType.HOME) return d.homeVisitPrice ?? d.consultationPrice;
    return d.consultationPrice;
  }

  private async history(m: EntityManager, appointmentId: string, from: AppointmentStatus | null, to: AppointmentStatus, by: string, note?: string | null) {
    await m.insert(AppointmentStatusHistory, { appointmentId, fromStatus: from, toStatus: to, changedById: by, note: note ?? null });
  }

  // ─────────────── Booking ───────────────

  async book(user: AuthUser, dto: BookAppointmentDto, meta: { ip?: string; userAgent?: string | null } = {}) {
    // The patient is the logged-in user. Only staff may book on behalf of someone else.
    let patientId = user.patientId;
    if (dto.patientId && dto.patientId !== user.patientId) {
      if (!user.permissions.has(P.APPOINTMENTS_MANAGE_ANY)) throw new ForbiddenException('غير مصرح بالحجز لمريض آخر');
      patientId = dto.patientId;
    }
    if (!patientId) throw new ForbiddenException('يجب أن يكون لديك ملف مريض لحجز موعد');

    const type = dto.type ?? AppointmentType.CLINIC;
    const startAt = new Date(dto.startAt);
    if (isNaN(startAt.getTime())) throw new BadRequestException('موعد غير صحيح');

    const maxActive = await this.settings.get<number>('booking.maxActivePerPatient');

    const saved = await this.withConstraintMapping(() =>
      this.ds.transaction(async (m) => {
        await this.lockDoctor(m, dto.doctorId);

        const doctor = await this.availability.loadDoctor(dto.doctorId, m);
        if (!this.availability.isBookable(doctor)) throw new BadRequestException('هذا الطبيب غير متاح للحجز حالياً');
        if (doctor.userId === user.id) throw new BadRequestException('لا يمكنك الحجز لدى نفسك');
        if (type === AppointmentType.ONLINE && !doctor.onlineAvailable) throw new BadRequestException('الطبيب لا يقدم كشفاً أونلاين');
        if (type === AppointmentType.HOME) {
          if (!doctor.homeVisitAvailable) throw new BadRequestException('الطبيب لا يقدم زيارات منزلية');
          if (!dto.homeAddress) throw new BadRequestException('من فضلك أدخل عنوان الزيارة المنزلية');
        }

        const patient = await m.findOne(Patient, { where: { id: patientId! }, relations: { user: true } });
        if (!patient || patient.user?.status !== 'ACTIVE') throw new BadRequestException('حساب المريض غير مفعل');

        const slot = await this.availability.resolveSlot(doctor.id, startAt, type, m);
        if (!slot) throw new BadRequestException({ message: 'الموعد المختار غير متاح في جدول الطبيب', code: 'INVALID_SLOT' });
        const endAt = new Date(slot.endAt);

        await this.assertNoOverlap(m, doctor.id, patientId!, startAt, endAt);

        const activeCount = await m.count(Appointment, {
          where: { patientId: patientId!, status: In([AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED]), startAt: MoreThan(new Date()) },
        });
        if (activeCount >= maxActive) throw new BadRequestException(`لا يمكن أن يكون لديك أكثر من ${maxActive} مواعيد قادمة`);

        const localDay = DateTime.fromJSDate(startAt).setZone(this.availability.tz);
        const sameDay = await m.count(Appointment, {
          where: {
            patientId: patientId!,
            doctorId: doctor.id,
            status: In([AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED]),
            startAt: MoreThan(localDay.startOf('day').toJSDate()),
            endAt: LessThan(localDay.endOf('day').toJSDate()),
          },
        });
        if (sameDay) throw new ConflictException({ message: 'لديك موعد بالفعل مع هذا الطبيب في نفس اليوم', code: 'DUPLICATE_DAY' });

        const primary = await m.findOne(DoctorSpecialty, { where: { doctorId: doctor.id, isPrimary: true } });
        const price = this.priceFor(doctor, type);
        const status = doctor.autoConfirm ? AppointmentStatus.CONFIRMED : AppointmentStatus.PENDING;

        const appt = await m.save(
          m.create(Appointment, {
            code: humanCode('APT'),
            patientId: patientId!,
            providerId: doctor.providerId,
            doctorId: doctor.id,
            specialtyId: primary?.specialtyId ?? null,
            branchId: type === AppointmentType.CLINIC ? slot.branchId : null,
            startAt,
            endAt,
            type,
            status,
            price,
            discount: 0,
            finalPrice: price,
            paymentStatus: PaymentStatus.PENDING,
            paymentMethod: PaymentMethod.CASH,
            notes: dto.notes ?? null,
            homeAddress: type === AppointmentType.HOME ? dto.homeAddress! : null,
            createdById: user.id,
          }),
        );
        if (dto.couponCode?.trim()) {
          const c = await this.coupons.redeem(m, { code: dto.couponCode, entityType: 'APPOINTMENT', entityId: appt.id, providerId: doctor.providerId, amount: price, patientId: patientId! });
          appt.discount = c.discount;
          appt.finalPrice = Math.round((price - c.discount) * 100) / 100;
          appt.couponId = c.couponId;
          await m.update(Appointment, appt.id, { discount: appt.discount, finalPrice: appt.finalPrice, couponId: c.couponId });
        }
        await this.history(m, appt.id, null, status, user.id);
        await this.audit.log({ userId: user.id, action: 'APPOINTMENT_BOOKED', entity: 'appointments', entityId: appt.id, newValue: { code: appt.code, startAt, doctorId: doctor.id }, ...meta }, m);
        return { appt, doctor, patient };
      }),
    );

    const { appt, doctor, patient } = saved;
    const when = this.fmt(appt.startAt);
    await this.notifications.notify(patient.userId, {
      type: appt.status === AppointmentStatus.CONFIRMED ? 'APPOINTMENT_CONFIRMED' : 'APPOINTMENT_REQUESTED',
      category: 'APPOINTMENTS',
      title: appt.status === AppointmentStatus.CONFIRMED ? 'تم تأكيد موعدك' : 'تم إرسال طلب الحجز',
      body: `موعدك مع ${doctor.provider?.nameAr} يوم ${when}. رقم الحجز ${appt.code}`,
      data: { appointmentId: appt.id },
    });
    await this.notifications.notify(doctor.userId, {
      type: 'APPOINTMENT_NEW',
      category: 'APPOINTMENTS',
      title: 'حجز جديد',
      body: `حجز جديد من ${patient.user?.fullName} يوم ${when}${appt.status === AppointmentStatus.PENDING ? ' — بانتظار تأكيدك' : ''}`,
      data: { appointmentId: appt.id },
    });
    return this.getOne(user, appt.id);
  }

  /** Translate the exclusion-constraint violation into a clean 409 (race lost at the DB level). */
  private async withConstraintMapping<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof QueryFailedError && (e as any).driverError?.code === '23P01') {
        throw new ConflictException({ message: 'هذا الموعد تم حجزه للتو، من فضلك اختر موعداً آخر', code: 'SLOT_UNAVAILABLE' });
      }
      throw e;
    }
  }

  // ─────────────── Read ───────────────

  private baseQuery() {
    return this.ds
      .getRepository(Appointment)
      .createQueryBuilder('a')
      .leftJoin('a.patient', 'pt')
      .addSelect(['pt.id', 'pt.dateOfBirth', 'pt.gender'])
      .leftJoin('pt.user', 'ptu')
      .addSelect(['ptu.id', 'ptu.fullName', 'ptu.phone', 'ptu.avatarFileId'])
      .leftJoin('a.provider', 'pr')
      .addSelect(['pr.id', 'pr.nameAr', 'pr.slug', 'pr.type', 'pr.whatsappNumber', 'pr.phone', 'pr.logoFileId'])
      .leftJoin('a.doctor', 'doc')
      .addSelect(['doc.id', 'doc.title', 'doc.cancellationWindowHours', 'doc.userId'])
      .leftJoin('doc.user', 'docu')
      .addSelect(['docu.id', 'docu.fullName', 'docu.avatarFileId'])
      .leftJoinAndSelect('a.specialty', 'sp')
      .leftJoinAndSelect('a.branch', 'br');
  }

  /** Visibility rules decide the SQL filter; no client-supplied id is trusted on its own. */
  private resolveScope(user: AuthUser, scope?: string): 'patient' | 'provider' | 'all' {
    if (scope === 'all' && user.permissions.has(P.APPOINTMENTS_READ_ANY)) return 'all';
    if (scope === 'provider' && user.permissions.has(P.APPOINTMENTS_READ_PROVIDER) && user.providerIds.length) return 'provider';
    if (scope === 'patient' && user.patientId) return 'patient';
    if (!scope) {
      if (user.permissions.has(P.APPOINTMENTS_READ_ANY)) return 'all';
      if (user.permissions.has(P.APPOINTMENTS_READ_PROVIDER) && user.providerIds.length) return 'provider';
      if (user.patientId) return 'patient';
    }
    throw new ForbiddenException('غير مصرح لك بعرض هذه المواعيد');
  }

  async list(user: AuthUser, q: ListAppointmentsQuery) {
    const scope = this.resolveScope(user, q.scope);
    const qb = this.baseQuery();
    if (scope === 'patient') qb.where('a.patientId = :pid', { pid: user.patientId });
    else if (scope === 'provider') qb.where('a.providerId IN (:...prov)', { prov: user.providerIds });
    else qb.where('1=1');

    if (q.status?.length) qb.andWhere('a.status IN (:...st)', { st: q.status });
    const now = new Date();
    if (q.when === 'upcoming') qb.andWhere('a.endAt >= :now', { now });
    if (q.when === 'past') qb.andWhere('a.endAt < :now', { now });
    if (q.when === 'today') {
      const d = DateTime.now().setZone(this.availability.tz);
      qb.andWhere('a.startAt >= :ds AND a.startAt < :de', { ds: d.startOf('day').toJSDate(), de: d.endOf('day').toJSDate() });
    }
    if (q.from) qb.andWhere('a.startAt >= :from', { from: q.from });
    if (q.to) qb.andWhere('a.startAt <= :to', { to: q.to });
    if (q.doctorId) qb.andWhere('a.doctorId = :did', { did: q.doctorId });
    if (q.patientId && scope !== 'patient') qb.andWhere('a.patientId = :fp', { fp: q.patientId });
    if (q.providerId && scope === 'all') qb.andWhere('a.providerId = :fprov', { fprov: q.providerId });
    if (q.search) {
      const s = `%${likeEscape(q.search)}%`;
      qb.andWhere(
        new Brackets((b) =>
          b.where('a.code ILIKE :s', { s }).orWhere('ptu.fullName ILIKE :s', { s }).orWhere('ptu.phone ILIKE :s', { s }).orWhere('pr.nameAr ILIKE :s', { s }),
        ),
      );
    }
    const dir = (q.sortDir?.toUpperCase() as 'ASC' | 'DESC') || (q.when === 'past' ? 'DESC' : 'ASC');
    qb.orderBy('a.startAt', dir);
    const { skip, take } = skipTake(q);
    const [rows, total] = await qb.skip(skip).take(take).getManyAndCount();
    return paginate(rows.map((a) => this.present(a, user)), total, q);
  }

  /** Strip provider-private fields when the viewer is the patient. */
  private present(a: Appointment, user: AuthUser) {
    const isProviderSide = user.providerIds.includes(a.providerId) || user.permissions.has(P.APPOINTMENTS_READ_ANY);
    const out: any = { ...a };
    if (!isProviderSide) delete out.doctorNotes;
    out.canCancel = this.canCancel(a, user).ok;
    out.canReschedule = out.canCancel;
    return out;
  }

  async getOne(user: AuthUser, id: string) {
    const a = await this.baseQuery()
      .leftJoinAndSelect('a.history', 'h')
      .where('a.id = :id', { id })
      .orderBy('h.createdAt', 'ASC')
      .getOne();
    if (!a) throw new NotFoundException('الموعد غير موجود');
    this.assertCanView(user, a);
    return this.present(a, user);
  }

  private assertCanView(user: AuthUser, a: Appointment) {
    if (a.patientId === user.patientId) return;
    if (user.providerIds.includes(a.providerId) && user.permissions.has(P.APPOINTMENTS_READ_PROVIDER)) return;
    if (user.permissions.has(P.APPOINTMENTS_READ_ANY)) return;
    // Same response as a missing record: never confirm that someone else's id exists.
    throw new NotFoundException('الموعد غير موجود');
  }

  private assertCanManage(user: AuthUser, a: Appointment) {
    if (user.providerIds.includes(a.providerId) && user.permissions.has(P.APPOINTMENTS_MANAGE_PROVIDER)) return;
    if (user.permissions.has(P.APPOINTMENTS_MANAGE_ANY)) return;
    throw new ForbiddenException('غير مصرح لك بتعديل هذا الموعد');
  }

  private canCancel(a: Appointment, user: AuthUser): { ok: boolean; reason?: string } {
    if (!CANCELLABLE.includes(a.status)) return { ok: false, reason: 'لا يمكن إلغاء موعد حالته ' + STATUS_AR[a.status] };
    if (a.startAt.getTime() <= Date.now()) return { ok: false, reason: 'لا يمكن إلغاء موعد بدأ بالفعل' };
    const staff = user.providerIds.includes(a.providerId) || user.permissions.has(P.APPOINTMENTS_MANAGE_ANY);
    if (staff) return { ok: true };
    if (a.patientId !== user.patientId) return { ok: false, reason: 'غير مصرح' };
    const windowH = (a.doctor as any)?.cancellationWindowHours ?? 2;
    if (a.startAt.getTime() - Date.now() < windowH * 3600_000) {
      return { ok: false, reason: `لا يمكن الإلغاء أو التعديل قبل الموعد بأقل من ${windowH} ساعة` };
    }
    return { ok: true };
  }

  // ─────────────── Mutations ───────────────

  async cancel(user: AuthUser, id: string, reason: string | undefined, meta: { ip?: string; userAgent?: string | null } = {}) {
    const a = await this.ds.transaction(async (m) => {
      const a = await m.findOne(Appointment, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!a) throw new NotFoundException('الموعد غير موجود');
      if (a.doctorId) a.doctor = (await m.findOneBy(Doctor, { id: a.doctorId })) ?? undefined;
      this.assertCanView(user, a);
      const check = this.canCancel(a, user);
      if (!check.ok) throw new BadRequestException(check.reason);
      const from = a.status;
      await m.update(Appointment, { id }, {
        status: AppointmentStatus.CANCELLED,
        cancelReason: reason ?? null,
        cancelledById: user.id,
        cancelledAt: new Date(),
      });
      await this.history(m, id, from, AppointmentStatus.CANCELLED, user.id, reason);
      await this.coupons.release(m, 'APPOINTMENT', id);
      await this.audit.log({ userId: user.id, action: 'APPOINTMENT_CANCELLED', entity: 'appointments', entityId: id, oldValue: { status: from }, newValue: { status: 'CANCELLED', reason }, ...meta }, m);
      return a;
    });
    await this.payments.refundOnCancel('APPOINTMENT', id, `إلغاء الموعد ${a.code}`);
    await this.notifyCounterpart(user, a, 'APPOINTMENT_CANCELLED', 'تم إلغاء الموعد', `تم إلغاء الموعد ${a.code} المحدد يوم ${this.fmt(a.startAt)}${reason ? ` — السبب: ${reason}` : ''}`);
    return this.getOne(user, id);
  }

  async reschedule(user: AuthUser, id: string, dto: RescheduleDto, meta: { ip?: string; userAgent?: string | null } = {}) {
    const newStart = new Date(dto.startAt);
    const result = await this.withConstraintMapping(() =>
      this.ds.transaction(async (m) => {
        const old = await m.findOne(Appointment, { where: { id }, relations: { doctor: true } });
        if (!old) throw new NotFoundException('الموعد غير موجود');
        this.assertCanView(user, old);
        if (!old.doctorId) throw new BadRequestException('هذا الموعد لا يدعم تغيير الموعد');
        await this.lockDoctor(m, old.doctorId);
        // Re-read under the lock: state may have changed while waiting.
        const fresh = await m.findOneOrFail(Appointment, { where: { id }, relations: { doctor: true } });
        const check = this.canCancel(fresh, user);
        if (!check.ok) throw new BadRequestException(check.reason);
        if (newStart.getTime() === fresh.startAt.getTime()) throw new BadRequestException('اختر موعداً مختلفاً');

        const slot = await this.availability.resolveSlot(fresh.doctorId!, newStart, fresh.type, m);
        if (!slot) throw new BadRequestException({ message: 'الموعد الجديد غير متاح في جدول الطبيب', code: 'INVALID_SLOT' });
        const newEnd = new Date(slot.endAt);

        // Free the old slot first, then claim the new one (allows moving into an overlapping slot).
        await m.update(Appointment, { id }, { status: AppointmentStatus.RESCHEDULED });
        await this.history(m, id, fresh.status, AppointmentStatus.RESCHEDULED, user.id, dto.reason);
        await this.assertNoOverlap(m, fresh.doctorId!, fresh.patientId, newStart, newEnd, id);

        const created = await m.save(
          m.create(Appointment, {
            code: humanCode('APT'),
            patientId: fresh.patientId,
            providerId: fresh.providerId,
            doctorId: fresh.doctorId,
            specialtyId: fresh.specialtyId,
            branchId: fresh.type === AppointmentType.CLINIC ? slot.branchId : null,
            startAt: newStart,
            endAt: newEnd,
            type: fresh.type,
            status: fresh.status === AppointmentStatus.PENDING ? AppointmentStatus.PENDING : AppointmentStatus.CONFIRMED,
            price: fresh.price,
            discount: fresh.discount,
            finalPrice: fresh.finalPrice,
            paymentStatus: fresh.paymentStatus,
            paymentMethod: fresh.paymentMethod,
            notes: fresh.notes,
            homeAddress: fresh.homeAddress,
            couponId: fresh.couponId,
            rescheduledFromId: fresh.id,
            createdById: user.id,
          }),
        );
        await this.history(m, created.id, null, created.status, user.id, `إعادة جدولة من ${fresh.code}`);
        // Money and the coupon follow the booking to its new time.
        await this.payments.movePayments(m, 'APPOINTMENT', fresh.id, created.id);
        await this.coupons.moveRedemption(m, 'APPOINTMENT', fresh.id, created.id);
        await this.audit.log(
          { userId: user.id, action: 'APPOINTMENT_RESCHEDULED', entity: 'appointments', entityId: id, oldValue: { startAt: fresh.startAt }, newValue: { newAppointmentId: created.id, startAt: newStart }, ...meta },
          m,
        );
        return { old: fresh, created };
      }),
    );
    await this.notifyCounterpart(
      user,
      result.created,
      'APPOINTMENT_RESCHEDULED',
      'تم تغيير موعد الحجز',
      `تم نقل الموعد من ${this.fmt(result.old.startAt)} إلى ${this.fmt(result.created.startAt)}. رقم الحجز الجديد ${result.created.code}`,
    );
    return this.getOne(user, result.created.id);
  }

  async updateStatus(user: AuthUser, id: string, dto: UpdateStatusDto, meta: { ip?: string; userAgent?: string | null } = {}) {
    const a = await this.ds.transaction(async (m) => {
      const a = await m.findOne(Appointment, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!a) throw new NotFoundException('الموعد غير موجود');
      this.assertCanManage(user, a);
      const allowed = TRANSITIONS[a.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`لا يمكن تغيير الحالة من "${STATUS_AR[a.status]}" إلى "${STATUS_AR[dto.status]}"`);
      }
      if (dto.status === AppointmentStatus.NO_SHOW && a.startAt.getTime() > Date.now()) {
        throw new BadRequestException('لا يمكن تسجيل عدم الحضور قبل موعد الكشف');
      }
      const patch: Record<string, unknown> = { status: dto.status };
      if (dto.status === AppointmentStatus.CHECKED_IN) patch.checkedInAt = new Date();
      if (dto.status === AppointmentStatus.COMPLETED) {
        patch.completedAt = new Date();
        // Clinic cash visits are settled at the desk.
        if (a.paymentMethod === PaymentMethod.CASH && a.paymentStatus === PaymentStatus.PENDING) patch.paymentStatus = PaymentStatus.PAID;
      }
      await m.update(Appointment, { id }, patch as any);
      if (patch.paymentStatus === PaymentStatus.PAID) await this.payments.recordOffline(m, 'APPOINTMENT', id, PaymentMethod.CASH, user.id);
      await this.history(m, id, a.status, dto.status, user.id, dto.note);
      await this.audit.log({ userId: user.id, action: `APPOINTMENT_${dto.status}`, entity: 'appointments', entityId: id, oldValue: { status: a.status }, newValue: { status: dto.status }, ...meta }, m);
      return a;
    });
    if (dto.status === AppointmentStatus.CONFIRMED) {
      await this.notifyPatient(a, 'APPOINTMENT_CONFIRMED', 'تم تأكيد موعدك', `تم تأكيد موعدك ${a.code} يوم ${this.fmt(a.startAt)}`);
    } else if (dto.status === AppointmentStatus.COMPLETED) {
      await this.notifyPatient(a, 'APPOINTMENT_COMPLETED', 'نتمنى لك الشفاء العاجل', `تم إنهاء الكشف ${a.code}. يمكنك الآن تقييم تجربتك.`);
    }
    return this.getOne(user, id);
  }

  async setDoctorNotes(user: AuthUser, id: string, doctorNotes: string) {
    const a = await this.ds.getRepository(Appointment).findOneBy({ id });
    if (!a) throw new NotFoundException('الموعد غير موجود');
    this.assertCanManage(user, a);
    await this.ds.getRepository(Appointment).update(id, { doctorNotes });
    await this.audit.log({ userId: user.id, action: 'APPOINTMENT_NOTES_UPDATED', entity: 'appointments', entityId: id });
    return this.getOne(user, id);
  }

  // ─────────────── Notifications ───────────────

  private async participants(a: Appointment) {
    const [row] = await this.ds.query(
      `SELECT pu.id AS patient_user_id, d.user_id AS doctor_user_id, pr.owner_user_id
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id JOIN users pu ON pu.id = p.user_id
         JOIN providers pr ON pr.id = a.provider_id
         LEFT JOIN doctors d ON d.id = a.doctor_id
        WHERE a.id = $1`,
      [a.id],
    );
    return { patientUserId: row?.patient_user_id as string, providerUserId: (row?.doctor_user_id || row?.owner_user_id) as string };
  }

  private async notifyPatient(a: Appointment, type: string, title: string, body: string) {
    const p = await this.participants(a);
    if (p.patientUserId) await this.notifications.notify(p.patientUserId, { type, category: 'APPOINTMENTS', title, body, data: { appointmentId: a.id } });
  }

  /** Notify the other side of the action (patient acted → provider, provider/admin acted → patient). */
  private async notifyCounterpart(actor: AuthUser, a: Appointment, type: string, title: string, body: string) {
    const p = await this.participants(a);
    const targets = [p.patientUserId, p.providerUserId].filter((x) => x && x !== actor.id);
    await this.notifications.notifyMany(targets, { type, category: 'APPOINTMENTS', title, body, data: { appointmentId: a.id } });
  }

  // ─────────────── Background jobs ───────────────

  /** Appointment reminders N hours ahead (setting appointments.reminderHours; runs every 10 minutes, idempotent via reminder_sent_at). */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'appointment-reminders' })
  async sendReminders() {
    if (process.env.NODE_ENV === 'test') return;
    const now = new Date();
    const hours = await this.settings.get<number>('appointments.reminderHours');
    const horizon = new Date(now.getTime() + hours * 3600_000);
    const due = await this.ds.getRepository(Appointment).find({
      where: { status: AppointmentStatus.CONFIRMED, reminderSentAt: IsNull(), startAt: MoreThan(now) },
      relations: { provider: true },
      take: 200,
    });
    for (const a of due.filter((x) => x.startAt <= horizon)) {
      // Claim atomically so multiple instances never double-send.
      const res = await this.ds.getRepository(Appointment).update({ id: a.id, reminderSentAt: IsNull() }, { reminderSentAt: new Date() });
      if (!res.affected) continue;
      await this.notifyPatient(a, 'APPOINTMENT_REMINDER', 'تذكير بموعدك', `تذكير: لديك موعد مع ${a.provider?.nameAr} يوم ${this.fmt(a.startAt)}`).catch((e) =>
        this.logger.warn(`reminder failed: ${e.message}`),
      );
    }
  }
}
