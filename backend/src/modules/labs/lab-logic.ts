/**
 * Pure laboratory rules (no I/O) — reference-range selection, result flagging,
 * booking windows and the order state machine. Unit-tested in test/unit/lab-logic.spec.ts.
 */
import { DateTime } from 'luxon';
import { Gender, LabOrderStatus, ResultFlag } from '../../database/entities/enums';

export interface RangeLike {
  gender: Gender | null;
  ageMinYears: number | null;
  ageMaxYears: number | null;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  textRange: string | null;
}

/** Whole years between date of birth and the reference date. */
export function ageInYears(dob: string | Date | null | undefined, at: Date = new Date()): number | null {
  if (!dob) return null;
  const d = DateTime.fromJSDate(new Date(dob));
  if (!d.isValid) return null;
  return Math.floor(DateTime.fromJSDate(at).diff(d, 'years').years);
}

/**
 * Most specific matching range wins: gender + age > gender > age > generic.
 * A range with a gender never matches a patient of unknown gender; an age-bounded
 * range never matches an unknown age.
 */
export function pickRange<T extends RangeLike>(ranges: T[], gender: Gender | null, age: number | null): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const r of ranges) {
    if (r.gender && r.gender !== gender) continue;
    const ageBound = r.ageMinYears !== null || r.ageMaxYears !== null;
    if (ageBound) {
      if (age === null) continue;
      if (r.ageMinYears !== null && age < r.ageMinYears) continue;
      if (r.ageMaxYears !== null && age > r.ageMaxYears) continue;
    }
    const score = (r.gender ? 2 : 0) + (ageBound ? 1 : 0);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

const trim = (n: number) => String(Number(n.toFixed(4)));

/** Human reference text for the report, e.g. "70 – 100", "< 200", "> 40". */
export function formatRange(r: RangeLike | null): string | null {
  if (!r) return null;
  if (r.low !== null && r.high !== null) return `${trim(r.low)} – ${trim(r.high)}`;
  if (r.high !== null) return `< ${trim(r.high)}`;
  if (r.low !== null) return `> ${trim(r.low)}`;
  return r.textRange || null;
}

/** Accepts "12.5", "12,5", Arabic-Indic digits "١٢٫٥", or a leading comparator ("<0.5"). */
export function parseNumeric(raw: string): number | null {
  const ascii = raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[٫,]/g, '.')
    .replace(/^[<>≤≥]=?\s*/, '');
  if (!/^-?\d+(\.\d+)?$/.test(ascii)) return null;
  const n = Number(ascii);
  return Number.isFinite(n) ? n : null;
}

export interface FlagOutcome {
  flag: ResultFlag;
  numericValue: number | null;
  referenceRange: string | null;
}

/**
 * Numeric parameters are flagged by the server only (the client value is ignored):
 * critical limits first, then the normal range. Text parameters keep the flag the
 * technician chose (default NORMAL).
 */
export function flagResult(
  value: string,
  resultType: 'NUMERIC' | 'TEXT',
  range: RangeLike | null,
  manualFlag?: ResultFlag | null,
): FlagOutcome {
  const referenceRange = formatRange(range);
  if (resultType === 'TEXT') return { flag: manualFlag ?? ResultFlag.NORMAL, numericValue: null, referenceRange };
  const n = parseNumeric(value);
  if (n === null) throw new Error('NOT_NUMERIC');
  if (!range) return { flag: ResultFlag.NORMAL, numericValue: n, referenceRange };
  if ((range.criticalLow !== null && n < range.criticalLow) || (range.criticalHigh !== null && n > range.criticalHigh)) {
    return { flag: ResultFlag.CRITICAL, numericValue: n, referenceRange };
  }
  if (range.low !== null && n < range.low) return { flag: ResultFlag.LOW, numericValue: n, referenceRange };
  if (range.high !== null && n > range.high) return { flag: ResultFlag.HIGH, numericValue: n, referenceRange };
  return { flag: ResultFlag.NORMAL, numericValue: n, referenceRange };
}

// ───────────── Booking windows ─────────────

export type OpeningHours = { day: number; open: number; close: number }[];

export interface WindowInput {
  hours: OpeningHours | null | undefined;
  /** Local calendar date YYYY-MM-DD in `tz`. */
  date: string;
  tz: string;
  windowMinutes: number;
  capacity: number;
  /** Booked count per window start (ISO string, UTC). */
  booked: Map<string, number>;
  now: Date;
  minLeadMinutes: number;
  horizonDays: number;
}

export interface BookingWindow {
  startAt: string;
  endAt: string;
  capacity: number;
  remaining: number;
}

/** Validates the opening-hours JSON shape (used by DTO validation as well). */
export function validHours(h: unknown): h is OpeningHours {
  return (
    Array.isArray(h) &&
    h.length <= 21 &&
    h.every(
      (x) =>
        x &&
        Number.isInteger(x.day) &&
        x.day >= 0 &&
        x.day <= 6 &&
        Number.isInteger(x.open) &&
        Number.isInteger(x.close) &&
        x.open >= 0 &&
        x.close <= 1440 &&
        x.open < x.close,
    )
  );
}

/** Bookable windows of one day. Full windows are returned with remaining = 0 so the UI can show them as taken. */
export function buildWindows(i: WindowInput): BookingWindow[] {
  if (!i.hours?.length || i.capacity < 1) return [];
  const day = DateTime.fromISO(i.date, { zone: i.tz });
  if (!day.isValid) return [];
  const today = DateTime.fromJSDate(i.now).setZone(i.tz).startOf('day');
  if (day < today || day > today.plus({ days: i.horizonDays })) return [];
  const weekday = day.weekday % 7; // luxon: Mon=1 … Sun=7 → Sun=0
  const earliest = DateTime.fromJSDate(i.now).plus({ minutes: i.minLeadMinutes });
  const out: BookingWindow[] = [];
  for (const block of i.hours.filter((h) => h.day === weekday).sort((a, b) => a.open - b.open)) {
    for (let m = block.open; m + i.windowMinutes <= block.close; m += i.windowMinutes) {
      const start = day.startOf('day').plus({ minutes: m });
      if (start < earliest) continue;
      const startAt = start.toUTC().toISO()!;
      const used = i.booked.get(startAt) ?? 0;
      out.push({
        startAt,
        endAt: start.plus({ minutes: i.windowMinutes }).toUTC().toISO()!,
        capacity: i.capacity,
        remaining: Math.max(0, i.capacity - used),
      });
    }
  }
  return out;
}

// ───────────── State machine ─────────────

/** Manual transitions available from the orders board. Result steps have their own endpoints. */
export const MANUAL_TRANSITIONS: Partial<Record<LabOrderStatus, LabOrderStatus[]>> = {
  [LabOrderStatus.NEW_ORDER]: [LabOrderStatus.PAID, LabOrderStatus.SAMPLE_COLLECTED],
  [LabOrderStatus.PAID]: [LabOrderStatus.SAMPLE_COLLECTED],
  [LabOrderStatus.SAMPLE_COLLECTED]: [LabOrderStatus.SAMPLE_RECEIVED],
  [LabOrderStatus.SAMPLE_RECEIVED]: [LabOrderStatus.PROCESSING],
  [LabOrderStatus.APPROVED]: [LabOrderStatus.DELIVERED],
};

export const PATIENT_CANCELLABLE = [LabOrderStatus.NEW_ORDER, LabOrderStatus.PAID];
export const LAB_CANCELLABLE = [
  LabOrderStatus.NEW_ORDER,
  LabOrderStatus.PAID,
  LabOrderStatus.SAMPLE_COLLECTED,
  LabOrderStatus.SAMPLE_RECEIVED,
  LabOrderStatus.PROCESSING,
];
/** Orders that still hold a booking window. */
export const ACTIVE_LAB_STATUSES = [LabOrderStatus.NEW_ORDER, LabOrderStatus.PAID];
export const OPEN_LAB_STATUSES = Object.values(LabOrderStatus).filter(
  (s) => ![LabOrderStatus.DELIVERED, LabOrderStatus.CANCELLED, LabOrderStatus.APPROVED].includes(s),
);
/** Results are visible to the patient only once approved. */
export const RELEASED_STATUSES = [LabOrderStatus.APPROVED, LabOrderStatus.DELIVERED];

export const LAB_STATUS_AR: Record<LabOrderStatus, string> = {
  NEW_ORDER: 'طلب جديد',
  PAID: 'تم الدفع',
  SAMPLE_COLLECTED: 'تم سحب العينة',
  SAMPLE_RECEIVED: 'العينة وصلت المعمل',
  PROCESSING: 'جاري التحليل',
  RESULT_ENTERED: 'تم إدخال النتائج',
  UNDER_REVIEW: 'قيد المراجعة',
  APPROVED: 'النتيجة معتمدة',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغي',
};

export const FLAG_AR: Record<ResultFlag, string> = {
  NORMAL: 'طبيعي',
  HIGH: 'مرتفع',
  LOW: 'منخفض',
  CRITICAL: 'حرج',
};

/** Minutes → "08:30". */
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
