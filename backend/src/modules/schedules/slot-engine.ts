import { DateTime } from 'luxon';
import { AppointmentType, ScheduleExceptionType } from '../../database/entities/enums';

/**
 * Pure slot-generation engine (no DB access → fully unit-testable).
 *
 * Weekly schedules are stored as minutes-from-midnight in the clinic timezone.
 * For a given local date we:
 *   1. drop the day entirely if a HOLIDAY/VACATION exception covers it,
 *   2. otherwise use CUSTOM_HOURS exceptions for that date if any, else the weekly blocks,
 *   3. walk each block in `slotDuration` steps, skipping breaks,
 *   4. convert each local start to an absolute UTC instant (DST-safe via Luxon),
 *   5. mark slots unavailable if in the past/lead window, manually blocked, or already booked.
 */

export interface ScheduleBlock {
  id?: string;
  dayOfWeek: number; // 0=Sun … 6=Sat
  startMinute: number;
  endMinute: number;
  slotDuration: number;
  branchId: string | null;
  appointmentType: AppointmentType;
  isActive?: boolean;
  breaks?: { startMinute: number; endMinute: number }[];
}

export interface ScheduleExceptionInput {
  type: ScheduleExceptionType;
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string; // YYYY-MM-DD inclusive
  startMinute?: number | null;
  endMinute?: number | null;
  slotDuration?: number | null;
  branchId?: string | null;
  reason?: string | null;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface Slot {
  startAt: string; // ISO UTC
  endAt: string;
  time: string; // HH:mm local
  durationMinutes: number;
  branchId: string | null;
  type: AppointmentType;
  available: boolean;
  reason?: 'PAST' | 'BOOKED' | 'BLOCKED';
}

export interface DaySlots {
  date: string;
  dayOfWeek: number;
  dayOff: boolean;
  dayOffReason?: string | null;
  slots: Slot[];
}

export interface GenerateInput {
  date: string;
  timezone: string;
  schedules: ScheduleBlock[];
  exceptions?: ScheduleExceptionInput[];
  blocked?: Interval[];
  booked?: Interval[];
  now?: Date;
  minLeadMinutes?: number;
  type?: AppointmentType;
}

const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;

export const minutesToHHmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function hhmmToMinutes(s: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s) || (s === '24:00' ? ['', '24', '00'] : null);
  if (!m) throw new Error(`Invalid time ${s}`);
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** JS weekday (Luxon: 1=Mon … 7=Sun) → 0=Sun … 6=Sat */
export const luxonToDow = (weekday: number) => weekday % 7;

export function generateDaySlots(input: GenerateInput): DaySlots {
  const tz = input.timezone;
  const day = DateTime.fromISO(input.date, { zone: tz }).startOf('day');
  if (!day.isValid) throw new Error(`Invalid date ${input.date}`);
  const dow = luxonToDow(day.weekday);
  const now = input.now ?? new Date();
  const earliest = now.getTime() + (input.minLeadMinutes ?? 0) * 60_000;

  const covering = (input.exceptions ?? []).filter((e) => e.startDate <= input.date && e.endDate >= input.date);
  const off = covering.find((e) => e.type === ScheduleExceptionType.HOLIDAY || e.type === ScheduleExceptionType.VACATION);
  if (off) return { date: input.date, dayOfWeek: dow, dayOff: true, dayOffReason: off.reason ?? off.type, slots: [] };

  const weekly = input.schedules.filter((s) => s.dayOfWeek === dow && s.isActive !== false);
  const custom = covering.filter((e) => e.type === ScheduleExceptionType.CUSTOM_HOURS && e.startMinute != null && e.endMinute != null);

  const blocks: ScheduleBlock[] = custom.length
    ? custom.map((e) => ({
        dayOfWeek: dow,
        startMinute: e.startMinute!,
        endMinute: e.endMinute!,
        slotDuration: e.slotDuration ?? weekly[0]?.slotDuration ?? input.schedules[0]?.slotDuration ?? 30,
        branchId: e.branchId ?? weekly[0]?.branchId ?? null,
        appointmentType: AppointmentType.CLINIC,
        breaks: [],
      }))
    : weekly;

  const booked = (input.booked ?? []).map((b) => [b.start.getTime(), b.end.getTime()] as const);
  const blocked = (input.blocked ?? []).map((b) => [b.start.getTime(), b.end.getTime()] as const);

  const seen = new Set<number>();
  const slots: Slot[] = [];
  const sorted = [...blocks].sort((a, b) => a.startMinute - b.startMinute);

  for (const block of sorted) {
    if (input.type && block.appointmentType !== input.type) continue;
    const dur = block.slotDuration;
    if (!dur || dur <= 0) continue;
    for (let m = block.startMinute; m + dur <= block.endMinute; m += dur) {
      if ((block.breaks ?? []).some((br) => overlaps(m, m + dur, br.startMinute, br.endMinute))) continue;
      const start = day.plus({ minutes: m });
      const startMs = start.toMillis();
      // Same instant offered by two overlapping blocks: the first block wins (a doctor can't be in two places).
      if (seen.has(startMs)) continue;
      seen.add(startMs);
      const endMs = start.plus({ minutes: dur }).toMillis();

      let reason: Slot['reason'];
      if (startMs < earliest) reason = 'PAST';
      else if (blocked.some(([s, e]) => overlaps(startMs, endMs, s, e))) reason = 'BLOCKED';
      else if (booked.some(([s, e]) => overlaps(startMs, endMs, s, e))) reason = 'BOOKED';

      slots.push({
        startAt: new Date(startMs).toISOString(),
        endAt: new Date(endMs).toISOString(),
        time: start.toFormat('HH:mm'),
        durationMinutes: dur,
        branchId: block.branchId,
        type: block.appointmentType,
        available: !reason,
        ...(reason ? { reason } : {}),
      });
    }
  }
  slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return { date: input.date, dayOfWeek: dow, dayOff: false, slots };
}

/** Validates a weekly schedule: blocks on the same day must not overlap; breaks must sit inside their block. */
export function validateWeeklySchedule(blocks: ScheduleBlock[]): string | null {
  for (const b of blocks) {
    if (b.dayOfWeek < 0 || b.dayOfWeek > 6) return 'يوم غير صحيح';
    if (b.endMinute <= b.startMinute) return 'وقت النهاية يجب أن يكون بعد وقت البداية';
    if (b.slotDuration < 5 || b.slotDuration > 240) return 'مدة الكشف يجب أن تكون بين 5 و 240 دقيقة';
    if (b.endMinute - b.startMinute < b.slotDuration) return 'فترة العمل أقصر من مدة الكشف';
    for (const br of b.breaks ?? []) {
      if (br.endMinute <= br.startMinute) return 'وقت الاستراحة غير صحيح';
      if (br.startMinute < b.startMinute || br.endMinute > b.endMinute) return 'الاستراحة يجب أن تكون داخل فترة العمل';
    }
  }
  for (let d = 0; d < 7; d++) {
    const day = blocks.filter((b) => b.dayOfWeek === d).sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < day.length; i++) {
      if (day[i].startMinute < day[i - 1].endMinute) return 'يوجد تداخل بين فترات العمل في نفس اليوم';
    }
  }
  return null;
}
