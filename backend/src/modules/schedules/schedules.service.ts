import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource, In, LessThan, MoreThan, MoreThanOrEqual } from 'typeorm';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  Appointment,
  AppointmentType,
  Doctor,
  DoctorSchedule,
  DoctorScheduleBreak,
  DoctorScheduleException,
  DoctorSlot,
  ProviderBranch,
  ScheduleExceptionType,
} from '../../database/entities';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { AuditService } from '../audit/audit.service';
import { AvailabilityService } from './availability.service';
import { hhmmToMinutes, minutesToHHmm, validateWeeklySchedule } from './slot-engine';
import { ExceptionDto, ReplaceScheduleDto, SlotBlockDto } from './schedules.dto';

@Injectable()
export class SchedulesService {
  constructor(
    private ds: DataSource,
    private audit: AuditService,
    private availability: AvailabilityService,
  ) {}

  /** The doctor whose schedule is being managed: always the caller's own, unless an admin targets one explicitly. */
  async resolveDoctor(user: AuthUser, doctorId?: string): Promise<Doctor> {
    let id = user.doctorId;
    if (doctorId && doctorId !== user.doctorId) {
      if (!user.permissions.has(P.PROVIDERS_MANAGE_ANY)) throw new ForbiddenException('غير مصرح');
      id = doctorId;
    }
    if (!id) throw new ForbiddenException('هذا الحساب ليس حساب طبيب');
    const d = await this.ds.getRepository(Doctor).findOneBy({ id });
    if (!d) throw new NotFoundException('الطبيب غير موجود');
    return d;
  }

  async get(user: AuthUser, doctorId?: string) {
    const d = await this.resolveDoctor(user, doctorId);
    const today = this.availability.todayLocal();
    const [schedules, exceptions, blocks, branches] = await Promise.all([
      this.ds.getRepository(DoctorSchedule).find({
        where: { doctorId: d.id },
        relations: { breaks: true, branch: true },
        order: { dayOfWeek: 'ASC', startMinute: 'ASC' },
      }),
      this.ds.getRepository(DoctorScheduleException).find({
        where: { doctorId: d.id, endDate: MoreThanOrEqual(today) },
        order: { startDate: 'ASC' },
      }),
      this.ds.getRepository(DoctorSlot).find({ where: { doctorId: d.id, endAt: MoreThan(new Date()) }, order: { startAt: 'ASC' } }),
      this.ds.getRepository(ProviderBranch).find({ where: { providerId: d.providerId }, order: { createdAt: 'ASC' } }),
    ]);
    return {
      doctorId: d.id,
      timezone: this.availability.tz,
      settings: { onlineAvailable: d.onlineAvailable, homeVisitAvailable: d.homeVisitAvailable, bookingHorizonDays: d.bookingHorizonDays },
      branches,
      blocks: schedules.map((s) => ({
        id: s.id,
        dayOfWeek: s.dayOfWeek,
        start: minutesToHHmm(s.startMinute),
        end: minutesToHHmm(s.endMinute),
        slotDuration: s.slotDuration,
        branchId: s.branchId,
        branchName: s.branch?.name ?? null,
        appointmentType: s.appointmentType,
        isActive: s.isActive,
        breaks: (s.breaks ?? [])
          .sort((a, b) => a.startMinute - b.startMinute)
          .map((b) => ({ start: minutesToHHmm(b.startMinute), end: minutesToHHmm(b.endMinute), label: b.label })),
      })),
      exceptions: exceptions.map((e) => ({
        ...e,
        start: e.startMinute != null ? minutesToHHmm(e.startMinute) : null,
        end: e.endMinute != null ? minutesToHHmm(e.endMinute) : null,
      })),
      slotBlocks: blocks,
    };
  }

  /** Replaces the whole weekly schedule atomically. Existing appointments are untouched. */
  async replace(user: AuthUser, dto: ReplaceScheduleDto, doctorId?: string) {
    const d = await this.resolveDoctor(user, doctorId);
    const blocks = dto.blocks.map((b) => ({
      dayOfWeek: b.dayOfWeek,
      startMinute: hhmmToMinutes(b.start),
      endMinute: hhmmToMinutes(b.end),
      slotDuration: b.slotDuration,
      branchId: b.branchId ?? null,
      appointmentType: b.appointmentType ?? AppointmentType.CLINIC,
      isActive: b.isActive ?? true,
      breaks: (b.breaks ?? []).map((br) => ({ startMinute: hhmmToMinutes(br.start), endMinute: hhmmToMinutes(br.end), label: br.label ?? null })),
    }));
    const err = validateWeeklySchedule(blocks);
    if (err) throw new BadRequestException(err);

    for (const b of blocks) {
      if (b.appointmentType === AppointmentType.ONLINE && !d.onlineAvailable) {
        throw new BadRequestException('فعّل الكشف أونلاين من الملف الشخصي أولاً');
      }
      if (b.appointmentType === AppointmentType.HOME && !d.homeVisitAvailable) {
        throw new BadRequestException('فعّل الزيارات المنزلية من الملف الشخصي أولاً');
      }
      if (b.appointmentType === AppointmentType.CLINIC && !b.branchId) {
        throw new BadRequestException('اختر العيادة/الفرع لكل فترة كشف في العيادة');
      }
    }
    const branchIds = [...new Set(blocks.map((b) => b.branchId).filter(Boolean))] as string[];
    if (branchIds.length) {
      const owned = await this.ds.getRepository(ProviderBranch).count({ where: { id: In(branchIds), providerId: d.providerId } });
      if (owned !== branchIds.length) throw new BadRequestException('أحد الفروع المختارة لا يتبع هذا الطبيب');
    }

    const old = await this.get(user, d.id);
    await this.ds.transaction(async (m) => {
      await m.delete(DoctorSchedule, { doctorId: d.id });
      for (const b of blocks) {
        const s = await m.save(
          m.create(DoctorSchedule, {
            doctorId: d.id,
            dayOfWeek: b.dayOfWeek,
            startMinute: b.startMinute,
            endMinute: b.endMinute,
            slotDuration: b.slotDuration,
            branchId: b.branchId,
            appointmentType: b.appointmentType,
            isActive: b.isActive,
          }),
        );
        if (b.breaks.length) await m.save(b.breaks.map((br) => m.create(DoctorScheduleBreak, { ...br, scheduleId: s.id })));
      }
      await this.audit.log(
        { userId: user.id, action: 'SCHEDULE_UPDATED', entity: 'doctors', entityId: d.id, oldValue: old.blocks, newValue: dto.blocks },
        m,
      );
    });
    return this.get(user, d.id);
  }

  async addException(user: AuthUser, dto: ExceptionDto, doctorId?: string) {
    const d = await this.resolveDoctor(user, doctorId);
    const startDate = dto.startDate.slice(0, 10);
    const endDate = dto.endDate.slice(0, 10);
    if (endDate < startDate) throw new BadRequestException('تاريخ النهاية قبل تاريخ البداية');
    let startMinute: number | null = null;
    let endMinute: number | null = null;
    if (dto.type === ScheduleExceptionType.CUSTOM_HOURS) {
      if (!dto.start || !dto.end) throw new BadRequestException('حدد مواعيد العمل لهذا اليوم');
      startMinute = hhmmToMinutes(dto.start);
      endMinute = hhmmToMinutes(dto.end);
      if (endMinute <= startMinute) throw new BadRequestException('وقت النهاية يجب أن يكون بعد وقت البداية');
    }
    if (dto.branchId) {
      const ok = await this.ds.getRepository(ProviderBranch).exists({ where: { id: dto.branchId, providerId: d.providerId } });
      if (!ok) throw new BadRequestException('الفرع غير صحيح');
    }
    const e = await this.ds.getRepository(DoctorScheduleException).save({
      doctorId: d.id,
      type: dto.type,
      startDate,
      endDate,
      startMinute,
      endMinute,
      slotDuration: dto.slotDuration ?? null,
      branchId: dto.branchId ?? null,
      reason: dto.reason ?? null,
    });

    // Report (do not silently cancel) existing bookings that now fall outside working time.
    const tz = this.availability.tz;
    const from = DateTime.fromISO(startDate, { zone: tz }).startOf('day').toJSDate();
    const to = DateTime.fromISO(endDate, { zone: tz }).endOf('day').toJSDate();
    const affected = await this.ds.getRepository(Appointment).find({
      where: { doctorId: d.id, status: In(ACTIVE_APPOINTMENT_STATUSES), startAt: MoreThan(from), endAt: LessThan(to) },
      relations: { patient: { user: true } },
      order: { startAt: 'ASC' },
    });
    const conflicts =
      dto.type === ScheduleExceptionType.CUSTOM_HOURS
        ? affected.filter((a) => {
            const lm = DateTime.fromJSDate(a.startAt).setZone(tz);
            const mins = lm.hour * 60 + lm.minute;
            return mins < startMinute! || mins >= endMinute!;
          })
        : affected;
    await this.audit.log({ userId: user.id, action: 'SCHEDULE_EXCEPTION_ADDED', entity: 'doctors', entityId: d.id, newValue: dto });
    return {
      exception: e,
      conflicts: conflicts.map((a) => ({ id: a.id, code: a.code, startAt: a.startAt, patientName: a.patient?.user?.fullName })),
    };
  }

  async deleteException(user: AuthUser, id: string, doctorId?: string) {
    const d = await this.resolveDoctor(user, doctorId);
    const res = await this.ds.getRepository(DoctorScheduleException).delete({ id, doctorId: d.id });
    if (!res.affected) throw new NotFoundException('الاستثناء غير موجود');
    return { deleted: true };
  }

  async addSlotBlock(user: AuthUser, dto: SlotBlockDto, doctorId?: string) {
    const d = await this.resolveDoctor(user, doctorId);
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt <= startAt) throw new BadRequestException('وقت النهاية يجب أن يكون بعد البداية');
    return this.ds.getRepository(DoctorSlot).save({ doctorId: d.id, startAt, endAt, reason: dto.reason ?? null });
  }

  async deleteSlotBlock(user: AuthUser, id: string, doctorId?: string) {
    const d = await this.resolveDoctor(user, doctorId);
    const res = await this.ds.getRepository(DoctorSlot).delete({ id, doctorId: d.id });
    if (!res.affected) throw new NotFoundException('غير موجود');
    return { deleted: true };
  }
}
