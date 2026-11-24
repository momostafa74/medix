import { DateTime } from 'luxon';

/** Pure analytics helpers (unit-tested). All dates are clinic-local calendar days. */

export type Granularity = 'day' | 'week' | 'month';

export interface Range {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  start: Date; // from 00:00 local
  end: Date; // day after `to` 00:00 local (exclusive)
  days: number;
}

export function makeRange(from: string | undefined, to: string | undefined, tz: string, defaultDays = 30): Range {
  const today = DateTime.now().setZone(tz).startOf('day');
  let t = to ? DateTime.fromISO(to, { zone: tz }).startOf('day') : today;
  let f = from ? DateTime.fromISO(from, { zone: tz }).startOf('day') : t.minus({ days: defaultDays - 1 });
  if (!f.isValid) f = today.minus({ days: defaultDays - 1 });
  if (!t.isValid) t = today;
  if (f > t) [f, t] = [t, f];
  // Hard cap: two years per query keeps every report fast.
  if (t.diff(f, 'days').days > 730) f = t.minus({ days: 730 });
  const end = t.plus({ days: 1 });
  return { from: f.toISODate()!, to: t.toISODate()!, start: f.toJSDate(), end: end.toJSDate(), days: Math.round(end.diff(f, 'days').days) };
}

/** The equally long period right before `r` (for "vs previous period"). */
export function previousRange(r: Range, tz: string): Range {
  const f = DateTime.fromJSDate(r.start, { zone: tz }).minus({ days: r.days });
  const t = DateTime.fromJSDate(r.start, { zone: tz }).minus({ days: 1 });
  return makeRange(f.toISODate()!, t.toISODate()!, tz);
}

/** Same period one year earlier (seasonality). */
export function yearAgoRange(r: Range, tz: string): Range {
  const f = DateTime.fromJSDate(r.start, { zone: tz }).minus({ years: 1 });
  const t = DateTime.fromJSDate(r.end, { zone: tz }).minus({ years: 1, days: 1 });
  return makeRange(f.toISODate()!, t.toISODate()!, tz);
}

/** % change rounded to one decimal; null when there is no base to compare with. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export const ratio = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : 0);

/** Sensible bucket size for a range length. */
export const autoGranularity = (days: number): Granularity => (days <= 45 ? 'day' : days <= 200 ? 'week' : 'month');

/** Every bucket key between start and end (so charts have no gaps). */
export function bucketKeys(r: Range, g: Granularity, tz: string): string[] {
  const keys: string[] = [];
  let d = DateTime.fromJSDate(r.start, { zone: tz }).startOf(g === 'week' ? 'week' : g);
  const end = DateTime.fromJSDate(r.end, { zone: tz });
  while (d < end) {
    keys.push(d.toISODate()!);
    d = d.plus(g === 'day' ? { days: 1 } : g === 'week' ? { weeks: 1 } : { months: 1 });
  }
  return keys;
}

export function fillSeries<T extends Record<string, unknown>>(keys: string[], rows: (T & { bucket: string })[], zero: Omit<T, 'bucket'>) {
  const map = new Map(rows.map((r) => [r.bucket, r]));
  return keys.map((k) => ({ ...zero, ...(map.get(k) ?? {}), bucket: k }));
}

/**
 * Monthly retention cohorts. Input: one row per (cohort month, activity month, patients).
 * Output: per cohort its size and the % of that cohort active in month +1 … +n.
 */
export function buildCohorts(rows: { cohort: string; month: string; patients: number }[], maxOffset = 5) {
  const byCohort = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const c = DateTime.fromISO(r.cohort);
    const m = DateTime.fromISO(r.month);
    const offset = Math.round(m.diff(c, 'months').months);
    if (offset < 0 || offset > maxOffset) continue;
    if (!byCohort.has(r.cohort)) byCohort.set(r.cohort, new Map());
    byCohort.get(r.cohort)!.set(offset, Number(r.patients));
  }
  return [...byCohort.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohort, offsets]) => {
      const size = offsets.get(0) ?? 0;
      return {
        cohort,
        size,
        retention: Array.from({ length: maxOffset }, (_, i) => (offsets.has(i + 1) ? ratio(offsets.get(i + 1)!, size) : null)),
      };
    });
}

export const AGE_GROUPS = [
  { key: '0-17', min: 0, max: 17 },
  { key: '18-29', min: 18, max: 29 },
  { key: '30-44', min: 30, max: 44 },
  { key: '45-59', min: 45, max: 59 },
  { key: '60+', min: 60, max: 200 },
];

export function ageGroup(age: number | null | undefined) {
  if (age == null || Number.isNaN(age)) return 'unknown';
  return AGE_GROUPS.find((g) => age >= g.min && age <= g.max)?.key ?? 'unknown';
}
