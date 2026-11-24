/**
 * Pure pharmacy & prescription rules (no I/O). Unit-tested in test/unit/pharmacy-logic.spec.ts.
 */
import { DateTime } from 'luxon';
import { FulfillmentType, PharmacyOrderStatus as S } from '../../database/entities/enums';

const round = (n: number) => Math.round(n * 100) / 100;

export interface DeliveryRules {
  deliveryAvailable: boolean;
  deliveryFee: number | null;
  freeDeliveryOver: number | null;
  minOrderForDelivery: number;
}

/** Delivery fee for a subtotal. Throws a code when delivery is not allowed. */
export function deliveryFeeFor(rules: DeliveryRules, fulfillment: FulfillmentType, subtotal: number): number {
  if (fulfillment === FulfillmentType.PICKUP) return 0;
  if (!rules.deliveryAvailable) throw new Error('NO_DELIVERY');
  if (subtotal < (rules.minOrderForDelivery ?? 0)) throw new Error('BELOW_MINIMUM');
  if (rules.freeDeliveryOver != null && subtotal >= rules.freeDeliveryOver) return 0;
  return round(Number(rules.deliveryFee ?? 0));
}

export function orderTotals(lines: { quantity: number; unitPrice: number }[], rules: DeliveryRules, fulfillment: FulfillmentType) {
  const subtotal = round(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const deliveryFee = lines.length ? deliveryFeeFor(rules, fulfillment, subtotal) : 0;
  return { subtotal, deliveryFee, total: round(subtotal + deliveryFee) };
}

/** Manual transitions from the pharmacy board (confirmation has its own endpoint). */
export function nextStatuses(status: S, fulfillment: FulfillmentType): S[] {
  switch (status) {
    case S.CONFIRMED:
      return [S.PREPARING];
    case S.PREPARING:
      return [S.READY];
    case S.READY:
      return fulfillment === FulfillmentType.DELIVERY ? [S.OUT_FOR_DELIVERY] : [S.DELIVERED];
    case S.OUT_FOR_DELIVERY:
      return [S.DELIVERED];
    default:
      return [];
  }
}

export const PATIENT_CANCELLABLE = [S.PENDING, S.CONFIRMED];
export const PHARMACY_CANCELLABLE = [S.PENDING, S.CONFIRMED, S.PREPARING, S.READY];
export const OPEN_STATUSES = [S.PENDING, S.CONFIRMED, S.PREPARING, S.READY, S.OUT_FOR_DELIVERY];

export const PH_STATUS_AR: Record<S, string> = {
  PENDING: 'طلب جديد',
  CONFIRMED: 'تم التأكيد',
  PREPARING: 'جاري التجهيز',
  READY: 'جاهز',
  OUT_FOR_DELIVERY: 'خرج للتوصيل',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغي',
};

export type RxState = 'ACTIVE' | 'DISPENSED' | 'REVOKED' | 'EXPIRED';

/** Lifecycle of an e-prescription for dispensing purposes. */
export function prescriptionState(rx: { revokedAt: Date | null; dispensedAt: Date | null; validUntil: string | Date | null }, now = new Date(), tz = 'Africa/Cairo'): RxState {
  if (rx.revokedAt) return 'REVOKED';
  if (rx.dispensedAt) return 'DISPENSED';
  const until = rx.validUntil instanceof Date ? rx.validUntil.toISOString().slice(0, 10) : rx.validUntil;
  if (until && DateTime.fromJSDate(now).setZone(tz).toISODate()! > until) return 'EXPIRED';
  return 'ACTIVE';
}

export const RX_STATE_AR: Record<RxState, string> = { ACTIVE: 'سارية', DISPENSED: 'تم صرفها', REVOKED: 'ملغاة', EXPIRED: 'منتهية' };

/**
 * Prescription-only items in a cart must be covered either by an e-prescription
 * that lists the same medicine, or by an uploaded prescription the pharmacist reviews.
 * Returns the names of uncovered items.
 */
export function uncoveredRxItems(
  cart: { medicineId: string; name: string; requiresPrescription: boolean }[],
  prescribedMedicineIds: Set<string>,
  hasUploadedPrescription: boolean,
): string[] {
  if (hasUploadedPrescription) return [];
  return cart.filter((c) => c.requiresPrescription && !prescribedMedicineIds.has(c.medicineId)).map((c) => c.name);
}

/** Is a branch open at `now` (opening hours in the clinic timezone)? Handles blocks that end at midnight. */
export function isOpenAt(hours: { day: number; open: number; close: number }[] | null | undefined, now: Date, tz = 'Africa/Cairo', is24Hours = false): boolean {
  if (is24Hours) return true;
  if (!hours?.length) return false;
  const t = DateTime.fromJSDate(now).setZone(tz);
  const day = t.weekday % 7;
  const minute = t.hour * 60 + t.minute;
  return hours.some((h) => h.day === day && minute >= h.open && minute < h.close);
}

/**
 * Display name of a catalog medicine — "Augmentin 1g Tablets". Strength is skipped
 * when the brand name already carries it ("Concor 5mg").
 */
export function medicineLabel(m: { nameEn: string; strength?: string | null; form?: string | null }): string {
  const squash = (v: string) => v.toLowerCase().replace(/\s+/g, '');
  const parts = [m.nameEn.trim()];
  // "Concor 5mg" carries "5mg"; "Ator 20" carries "20mg" (the number alone is enough).
  const inName = (v: string) => squash(m.nameEn).includes(squash(v)) || (/^\d[\d.]*$/.test(squash(v).replace(/[a-zµ%]+$/i, '')) && new RegExp(`(^|\\D)${squash(v).replace(/[a-zµ%]+$/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\D|$)`).test(squash(m.nameEn)));
  if (m.strength && !inName(m.strength)) parts.push(m.strength);
  if (m.form) parts.push(m.form);
  return parts.join(' ');
}

/** Deduplication key for medicines added by pharmacies: name + strength + form, case/space-insensitive. */
export const medicineKey = (m: { nameEn: string; strength?: string | null; form?: string | null }) =>
  [m.nameEn, m.strength ?? '', m.form ?? ''].map((s) => s.toLowerCase().replace(/\s+/g, '')).join('|');
