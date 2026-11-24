import { AppointmentType, ScheduleExceptionType } from '../../src/database/entities/enums';
import { generateDaySlots, validateWeeklySchedule, ScheduleBlock } from '../../src/modules/schedules/slot-engine';

const TZ = 'Africa/Cairo';
// 2026-10-04 is a Sunday (dayOfWeek 0). Egypt is UTC+3 in October 2026 (summer time).
const SUNDAY = '2026-10-04';
const block = (over: Partial<ScheduleBlock> = {}): ScheduleBlock => ({
  dayOfWeek: 0,
  startMinute: 10 * 60,
  endMinute: 14 * 60,
  slotDuration: 20,
  branchId: 'b1',
  appointmentType: AppointmentType.CLINIC,
  breaks: [],
  ...over,
});
const longAgo = new Date('2020-01-01T00:00:00Z');

describe('slot engine', () => {
  it('generates 20-minute slots 10:00 → 14:00 (spec example)', () => {
    const d = generateDaySlots({ date: SUNDAY, timezone: TZ, schedules: [block()], now: longAgo });
    expect(d.slots.map((s) => s.time).slice(0, 5)).toEqual(['10:00', '10:20', '10:40', '11:00', '11:20']);
    expect(d.slots).toHaveLength(12);
    expect(d.slots.every((s) => s.available)).toBe(true);
  });

  it('converts local clinic time to the correct UTC instant', () => {
    const d = generateDaySlots({ date: SUNDAY, timezone: TZ, schedules: [block()], now: longAgo });
    expect(d.slots[0].startAt).toBe('2026-10-04T07:00:00.000Z');
    expect(d.slots[0].endAt).toBe('2026-10-04T07:20:00.000Z');
  });

  it('returns nothing on days without a schedule', () => {
    const d = generateDaySlots({ date: '2026-10-05', timezone: TZ, schedules: [block()], now: longAgo });
    expect(d.slots).toHaveLength(0);
    expect(d.dayOff).toBe(false);
  });

  it('skips slots that overlap a break', () => {
    const d = generateDaySlots({
      date: SUNDAY,
      timezone: TZ,
      schedules: [block({ breaks: [{ startMinute: 12 * 60, endMinute: 12 * 60 + 30 }] })],
      now: longAgo,
    });
    const times = d.slots.map((s) => s.time);
    expect(times).not.toContain('12:00');
    expect(times).not.toContain('12:20'); // 12:20–12:40 overlaps break until 12:30
    expect(times).toContain('11:40');
    expect(times).toContain('12:40');
  });

  it('drops the whole day for vacations/holidays', () => {
    const d = generateDaySlots({
      date: SUNDAY,
      timezone: TZ,
      schedules: [block()],
      exceptions: [{ type: ScheduleExceptionType.VACATION, startDate: '2026-10-01', endDate: '2026-10-10', reason: 'إجازة' }],
      now: longAgo,
    });
    expect(d.dayOff).toBe(true);
    expect(d.dayOffReason).toBe('إجازة');
    expect(d.slots).toHaveLength(0);
  });

  it('uses CUSTOM_HOURS instead of weekly hours for that date', () => {
    const d = generateDaySlots({
      date: SUNDAY,
      timezone: TZ,
      schedules: [block()],
      exceptions: [{ type: ScheduleExceptionType.CUSTOM_HOURS, startDate: SUNDAY, endDate: SUNDAY, startMinute: 18 * 60, endMinute: 19 * 60, slotDuration: 30 }],
      now: longAgo,
    });
    expect(d.slots.map((s) => s.time)).toEqual(['18:00', '18:30']);
  });

  it('marks booked, blocked and past slots unavailable', () => {
    const now = new Date('2026-10-04T07:30:00Z'); // 10:30 local
    const d = generateDaySlots({
      date: SUNDAY,
      timezone: TZ,
      schedules: [block()],
      booked: [{ start: new Date('2026-10-04T08:00:00Z'), end: new Date('2026-10-04T08:20:00Z') }], // 11:00
      blocked: [{ start: new Date('2026-10-04T09:00:00Z'), end: new Date('2026-10-04T09:40:00Z') }], // 12:00–12:40
      now,
    });
    const by = Object.fromEntries(d.slots.map((s) => [s.time, s.reason ?? 'OK']));
    expect(by['10:00']).toBe('PAST');
    expect(by['10:20']).toBe('PAST');
    expect(by['10:40']).toBe('OK');
    expect(by['11:00']).toBe('BOOKED');
    expect(by['12:00']).toBe('BLOCKED');
    expect(by['12:20']).toBe('BLOCKED');
    expect(by['12:40']).toBe('OK');
  });

  it('respects the minimum lead time', () => {
    const now = new Date('2026-10-04T07:00:00Z'); // 10:00 local
    const d = generateDaySlots({ date: SUNDAY, timezone: TZ, schedules: [block()], now, minLeadMinutes: 60 });
    expect(d.slots.find((s) => s.available)!.time).toBe('11:00');
  });

  it('never offers the same instant twice when blocks overlap', () => {
    const d = generateDaySlots({
      date: SUNDAY,
      timezone: TZ,
      schedules: [block(), block({ appointmentType: AppointmentType.ONLINE, branchId: null })],
      now: longAgo,
    });
    expect(new Set(d.slots.map((s) => s.startAt)).size).toBe(d.slots.length);
  });

  it('filters by appointment type', () => {
    const d = generateDaySlots({
      date: SUNDAY,
      timezone: TZ,
      schedules: [block(), block({ startMinute: 20 * 60, endMinute: 21 * 60, appointmentType: AppointmentType.ONLINE })],
      type: AppointmentType.ONLINE,
      now: longAgo,
    });
    expect(d.slots.every((s) => s.type === AppointmentType.ONLINE)).toBe(true);
    expect(d.slots).toHaveLength(3);
  });

  it('does not emit a trailing partial slot', () => {
    const d = generateDaySlots({ date: SUNDAY, timezone: TZ, schedules: [block({ endMinute: 10 * 60 + 50 })], now: longAgo });
    expect(d.slots.map((s) => s.time)).toEqual(['10:00', '10:20']);
  });
});

describe('weekly schedule validation', () => {
  it('rejects overlapping blocks on the same day', () => {
    expect(validateWeeklySchedule([block(), block({ startMinute: 13 * 60, endMinute: 15 * 60 })])).toMatch(/تداخل/);
  });
  it('rejects breaks outside the block', () => {
    expect(validateWeeklySchedule([block({ breaks: [{ startMinute: 9 * 60, endMinute: 10 * 60 }] })])).toMatch(/الاستراحة/);
  });
  it('accepts a valid week', () => {
    expect(validateWeeklySchedule([block(), block({ dayOfWeek: 2, startMinute: 16 * 60, endMinute: 21 * 60 })])).toBeNull();
  });
});
