import { DateTime } from 'luxon';
import { Gender, ResultFlag } from '../../src/database/entities/enums';
import { ageInYears, buildWindows, flagResult, formatRange, parseNumeric, pickRange, validHours } from '../../src/modules/labs/lab-logic';

const R = (o: Partial<Parameters<typeof pickRange>[0][number]>) => ({
  gender: null,
  ageMinYears: null,
  ageMaxYears: null,
  low: null,
  high: null,
  criticalLow: null,
  criticalHigh: null,
  textRange: null,
  ...o,
});

describe('lab reference ranges', () => {
  const ranges = [
    R({ low: 1, high: 2 }),
    R({ gender: Gender.MALE, low: 13.5, high: 17.5 }),
    R({ gender: Gender.FEMALE, low: 12, high: 15.5 }),
    R({ ageMaxYears: 12, low: 11, high: 14.5 }),
    R({ gender: Gender.FEMALE, ageMinYears: 60, low: 11.5, high: 15 }),
  ];
  it('picks the most specific matching range', () => {
    expect(pickRange(ranges, Gender.MALE, 30)!.low).toBe(13.5);
    expect(pickRange(ranges, Gender.FEMALE, 30)!.low).toBe(12);
    expect(pickRange(ranges, Gender.FEMALE, 70)!.low).toBe(11.5);
    expect(pickRange(ranges, null, 8)!.low).toBe(11);
    expect(pickRange(ranges, null, null)!.low).toBe(1);
  });
  it('never matches gender/age-bound ranges for unknown patients', () => {
    expect(pickRange([R({ gender: Gender.MALE, low: 1 })], null, 30)).toBeNull();
    expect(pickRange([R({ ageMinYears: 18, low: 1 })], Gender.MALE, null)).toBeNull();
  });
  it('formats ranges for the report', () => {
    expect(formatRange(R({ low: 70, high: 100 }))).toBe('70 – 100');
    expect(formatRange(R({ high: 200 }))).toBe('< 200');
    expect(formatRange(R({ low: 40 }))).toBe('> 40');
    expect(formatRange(R({ textRange: 'Negative' }))).toBe('Negative');
    expect(formatRange(null)).toBeNull();
  });
});

describe('result flagging', () => {
  const r = R({ low: 70, high: 100, criticalLow: 50, criticalHigh: 400 });
  it('flags numeric values server-side', () => {
    expect(flagResult('85', 'NUMERIC', r).flag).toBe(ResultFlag.NORMAL);
    expect(flagResult('101', 'NUMERIC', r).flag).toBe(ResultFlag.HIGH);
    expect(flagResult('69.9', 'NUMERIC', r).flag).toBe(ResultFlag.LOW);
    expect(flagResult('401', 'NUMERIC', r).flag).toBe(ResultFlag.CRITICAL);
    expect(flagResult('49', 'NUMERIC', r).flag).toBe(ResultFlag.CRITICAL);
    expect(flagResult('400', 'NUMERIC', r).flag).toBe(ResultFlag.HIGH); // boundary is not critical
    expect(flagResult('85', 'NUMERIC', r, ResultFlag.CRITICAL).flag).toBe(ResultFlag.NORMAL); // client flag ignored
  });
  it('accepts Arabic digits, comma decimals and comparators', () => {
    expect(parseNumeric('١٢٫٥')).toBe(12.5);
    expect(parseNumeric('12,5')).toBe(12.5);
    expect(parseNumeric('<0.5')).toBe(0.5);
    expect(parseNumeric('abc')).toBeNull();
    expect(() => flagResult('abc', 'NUMERIC', r)).toThrow('NOT_NUMERIC');
  });
  it('keeps the technician flag for text parameters', () => {
    expect(flagResult('Positive', 'TEXT', R({ textRange: 'Negative' }), ResultFlag.HIGH)).toEqual({ flag: 'HIGH', numericValue: null, referenceRange: 'Negative' });
  });
  it('computes age in whole years', () => {
    expect(ageInYears('2000-06-15', new Date('2026-06-14T12:00:00Z'))).toBe(25);
    expect(ageInYears('2000-06-15', new Date('2026-06-16T12:00:00Z'))).toBe(26);
    expect(ageInYears(null)).toBeNull();
  });
});

describe('booking windows', () => {
  const tz = 'Africa/Cairo';
  const now = DateTime.fromISO('2026-10-05T07:00', { zone: tz }).toJSDate(); // Monday 07:00
  const base = { tz, windowMinutes: 30, capacity: 3, booked: new Map<string, number>(), now, minLeadMinutes: 60, horizonDays: 14 };
  it('splits opening hours into windows and respects lead time', () => {
    const w = buildWindows({ ...base, minLeadMinutes: 61, hours: [{ day: 1, open: 480, close: 600 }], date: '2026-10-05' });
    // 08:00 is inside the 61-minute lead time from 07:00 → excluded
    expect(w.map((x) => DateTime.fromISO(x.startAt).setZone(tz).toFormat('HH:mm'))).toEqual(['08:30', '09:00', '09:30']);
  });
  it('reports remaining capacity and keeps full windows visible', () => {
    const start = DateTime.fromISO('2026-10-06T09:00', { zone: tz }).toUTC().toISO()!;
    const w = buildWindows({ ...base, hours: [{ day: 2, open: 540, close: 600 }], date: '2026-10-06', booked: new Map([[start, 3]]) });
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ startAt: start, remaining: 0 });
    expect(w[1].remaining).toBe(3);
  });
  it('returns nothing for closed days, past days and beyond the horizon', () => {
    const hours = [{ day: 1, open: 480, close: 1200 }];
    expect(buildWindows({ ...base, hours, date: '2026-10-06' })).toEqual([]);
    expect(buildWindows({ ...base, hours, date: '2026-09-28' })).toEqual([]);
    expect(buildWindows({ ...base, hours, date: '2026-10-26' })).toEqual([]);
    expect(buildWindows({ ...base, hours: null, date: '2026-10-05' })).toEqual([]);
  });
  it('validates opening hours', () => {
    expect(validHours([{ day: 0, open: 480, close: 1440 }])).toBe(true);
    expect(validHours([{ day: 7, open: 480, close: 600 }])).toBe(false);
    expect(validHours([{ day: 1, open: 600, close: 600 }])).toBe(false);
    expect(validHours('x')).toBe(false);
  });
});
