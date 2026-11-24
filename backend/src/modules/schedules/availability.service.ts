import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { DataSource, EntityManager, In, LessThan, MoreThan } from 'typeorm';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  Appointment,
  AppointmentType,
  Doctor,
  DoctorSchedule,
  DoctorScheduleException,
  DoctorSlot,
  VerificationStatus,
} from '../../database/entities';
import { SettingsService } from '../settings/settings.service';
import { DaySlots, generateDaySlots, Slot } from './slot-engine';

@Injectable()
export class AvailabilityService {
  constructor(
    private ds: DataSource,
    private config: ConfigService,
    private settings: SettingsService,
  ) {}

  get tz(): string {
    return this.config.get('timezone')!;
  }

  todayLocal() {
    return DateTime.now().setZone(this.tz).toISODate()!;
  }

  async loadDoctor(doctorId: string, m: EntityManager = this.ds.manager) {
    const d = await m.findOne(Doctor, { where: { id: doctorId }, relations: { provider: { owner: true } } });
    if (!d) throw new NotFoundException('الطبيب غير موجود');
    return d;
  }

  isBookable(d: Doctor) {
    return d.provider?.verificationStatus === VerificationStatus.APPROVED && d.provider.isActive && d.provider.subscriptionActive !== false && d.provider.owner?.status === 'ACTIVE';
  }

  /** Days with slots, from `from` (local date) for `days` days. */
  async getRange(doctorId: string, from: string, days: number, type?: AppointmentType, m: EntityManager = this.ds.manager): Promise<DaySlots[]> {
    const start = DateTime.fromISO(from, { zone: this.tz });
    if (!start.isValid) throw new BadRequestException('تاريخ غير صحيح');
    const doctor = await this.loadDoctor(doctorId, m);
    const horizonEnd = DateTime.now().setZone(this.tz).startOf('day').plus({ days: doctor.bookingHorizonDays });
    const end = DateTime.min(start.plus({ days }), horizonEnd.plus({ days: 1 }));
    if (end <= start) return [];

    // Inside a transaction every query shares one connection — run them one after another
    // (pg does not allow concurrent queries on a single client).
    const inTx = !!m.queryRunner?.isTransactionActive;
    const run = async <T extends unknown[]>(fns: { [K in keyof T]: () => Promise<T[K]> }): Promise<T> =>
      (inTx ? fns.reduce(async (acc: Promise<unknown[]>, f) => [...(await acc), await f()], Promise.resolve([])) : Promise.all(fns.map((f) => f()))) as Promise<T>;
    const [schedules, exceptions, blocks, booked, minLead] = await run<[DoctorSchedule[], DoctorScheduleException[], DoctorSlot[], Appointment[], number]>([
      () => m.find(DoctorSchedule, { where: { doctorId, isActive: true }, relations: { breaks: true } }),
      () => m
        .getRepository(DoctorScheduleException)
        .createQueryBuilder('e')
        .where('e.doctorId = :doctorId AND e.endDate >= :from AND e.startDate <= :to', {
          doctorId,
          from: start.toISODate(),
          to: end.toISODate(),
        })
        .getMany(),
      () => m.find(DoctorSlot, { where: { doctorId, startAt: LessThan(end.toJSDate()), endAt: MoreThan(start.toJSDate()) } }),
      () => m.find(Appointment, {
        select: { id: true, startAt: true, endAt: true },
        where: {
          doctorId,
          status: In(ACTIVE_APPOINTMENT_STATUSES),
          startAt: LessThan(end.toJSDate()),
          endAt: MoreThan(start.toJSDate()),
        },
      }),
      () => this.settings.get<number>('booking.minLeadMinutes'),
    ]);

    const out: DaySlots[] = [];
    for (let d = start; d < end; d = d.plus({ days: 1 })) {
      out.push(
        generateDaySlots({
          date: d.toISODate()!,
          timezone: this.tz,
          schedules: schedules.map((s) => ({ ...s, breaks: s.breaks ?? [] })),
          exceptions,
          blocked: blocks.map((b) => ({ start: b.startAt, end: b.endAt })),
          booked: booked.map((a) => ({ start: a.startAt, end: a.endAt })),
          minLeadMinutes: minLead,
          type,
        }),
      );
    }
    return out;
  }

  /**
   * Resolve a requested start instant to a legitimate slot from the doctor's
   * schedule. Booked-ness is NOT considered here — that is decided under the
   * transaction lock / exclusion constraint.
   */
  async resolveSlot(doctorId: string, startAt: Date, type: AppointmentType, m: EntityManager): Promise<Slot | null> {
    const local = DateTime.fromJSDate(startAt).setZone(this.tz);
    const [day] = await this.getRange(doctorId, local.toISODate()!, 1, type, m);
    const slot = day?.slots.find((s) => new Date(s.startAt).getTime() === startAt.getTime());
    if (!slot || slot.reason === 'PAST' || slot.reason === 'BLOCKED') return null;
    return slot;
  }

  /** First available slot within the next N days (profile badge). */
  async nextAvailable(doctorId: string, lookaheadDays = 14): Promise<Slot | null> {
    const days = await this.getRange(doctorId, this.todayLocal(), lookaheadDays);
    for (const d of days) {
      const s = d.slots.find((x) => x.available);
      if (s) return s;
    }
    return null;
  }
}
