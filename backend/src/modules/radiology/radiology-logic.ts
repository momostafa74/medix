/**
 * Pure radiology rules (no I/O): exam slots against machine capacity, the order
 * state machine and DICOM-friendly identifiers. Unit-tested in test/unit/radiology-logic.spec.ts.
 */
import { DateTime } from 'luxon';
import { createHash } from 'crypto';
import { RadiologyOrderStatus as S } from '../../database/entities/enums';
import type { OpeningHours } from '../labs/lab-logic';

export const MODALITIES: Record<string, string> = {
  XRAY: 'أشعة عادية (X-Ray)',
  US: 'سونار / موجات صوتية',
  CT: 'أشعة مقطعية',
  MRI: 'رنين مغناطيسي',
  MAMMO: 'ماموجرام',
  DEXA: 'قياس كثافة العظام',
  FLUORO: 'أشعة بالصبغة',
  ECHO: 'إيكو',
  OTHER: 'أخرى',
};

export interface ExamSlotInput {
  hours: OpeningHours | null | undefined;
  date: string;
  tz: string;
  stepMinutes: number;
  durationMinutes: number;
  /** Machines of this modality in the branch. */
  units: number;
  /** Active bookings on the same branch + modality that day. */
  busy: { start: Date; end: Date }[];
  now: Date;
  minLeadMinutes: number;
  horizonDays: number;
}

export interface ExamSlot {
  startAt: string;
  endAt: string;
  remaining: number;
}

/**
 * Start times on the step grid where the whole exam fits inside an opening block.
 * `remaining` = machines minus exams overlapping that interval (conservative: any
 * overlap occupies a machine). Full slots are returned with remaining = 0.
 */
export function buildExamSlots(i: ExamSlotInput): ExamSlot[] {
  if (!i.hours?.length || i.units < 1 || i.durationMinutes < 1 || i.stepMinutes < 1) return [];
  const day = DateTime.fromISO(i.date, { zone: i.tz });
  if (!day.isValid) return [];
  const today = DateTime.fromJSDate(i.now).setZone(i.tz).startOf('day');
  if (day < today || day > today.plus({ days: i.horizonDays })) return [];
  const weekday = day.weekday % 7;
  const earliest = DateTime.fromJSDate(i.now).plus({ minutes: i.minLeadMinutes });
  const out: ExamSlot[] = [];
  for (const b of i.hours.filter((h) => h.day === weekday).sort((x, y) => x.open - y.open)) {
    const first = Math.ceil(b.open / i.stepMinutes) * i.stepMinutes;
    for (let m = first; m + i.durationMinutes <= b.close; m += i.stepMinutes) {
      const start = day.startOf('day').plus({ minutes: m });
      if (start < earliest) continue;
      const end = start.plus({ minutes: i.durationMinutes });
      const s = start.toMillis();
      const e = end.toMillis();
      const overlapping = i.busy.filter((x) => x.start.getTime() < e && x.end.getTime() > s).length;
      out.push({ startAt: start.toUTC().toISO()!, endAt: end.toUTC().toISO()!, remaining: Math.max(0, i.units - overlapping) });
    }
  }
  return out;
}

/** Front-desk / technologist transitions. Reporting steps have dedicated endpoints. */
export const MANUAL_TRANSITIONS: Partial<Record<S, S[]>> = {
  [S.BOOKED]: [S.CHECKED_IN, S.NO_SHOW],
  [S.CHECKED_IN]: [S.EXAMINATION],
  [S.EXAMINATION]: [S.REPORTING],
  [S.APPROVED]: [S.DELIVERED],
};

/** Statuses that occupy a machine slot. */
export const OCCUPYING = [S.BOOKED, S.CHECKED_IN, S.EXAMINATION];
export const PATIENT_CANCELLABLE = [S.BOOKED];
export const CENTER_CANCELLABLE = [S.BOOKED, S.CHECKED_IN];
export const RELEASED = [S.APPROVED, S.DELIVERED];

export const RAD_STATUS_AR: Record<S, string> = {
  BOOKED: 'محجوز',
  CHECKED_IN: 'تم الحضور',
  EXAMINATION: 'جاري الفحص',
  REPORTING: 'كتابة التقرير',
  APPROVED: 'التقرير جاهز',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغي',
  NO_SHOW: 'لم يحضر',
};

/**
 * DICOM Study Instance UID derived from a UUID (the standard "2.25." root,
 * ITU-T X.667) — globally unique without a registered org root, max 64 chars.
 */
export function studyUidFrom(uuid: string): string {
  return `2.25.${BigInt('0x' + uuid.replace(/-/g, '')).toString(10)}`;
}

/** Accession number: short, unique per center/day, safe for HL7/DICOM (≤ 16 chars). */
export function accessionNumber(orderId: string, at: Date): string {
  const d = DateTime.fromJSDate(at).toFormat('yyMMdd');
  const h = createHash('sha1').update(orderId).digest('hex').slice(0, 6).toUpperCase();
  return `A${d}${h}`;
}

/** Our modality codes → DICOM (0008,0060) Modality values used on the worklist. */
export const DICOM_MODALITY: Record<string, string> = { XRAY: 'DX', US: 'US', CT: 'CT', MRI: 'MR', MAMMO: 'MG', DEXA: 'DX', FLUORO: 'RF', ECHO: 'US', OTHER: 'OT' };

/** DICOM Person Name: FAMILY^GIVEN (we only have a full name). */
export const dicomName = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[parts.length - 1]}^${parts.slice(0, -1).join(' ')}` : full;
};
