/**
 * Pure money rules (no I/O): coupons, refunds vs commission, provider balances,
 * subscription periods and gateway signatures. Unit-tested in test/unit/payments-logic.spec.ts.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { DiscountType } from '../../database/entities/enums';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const SERVICE_TYPES = ['APPOINTMENT', 'LAB', 'RADIOLOGY', 'PHARMACY', 'SUBSCRIPTION'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const ENTITY_SERVICE: Record<string, ServiceType> = {
  APPOINTMENT: 'APPOINTMENT',
  LAB_ORDER: 'LAB',
  RADIOLOGY_ORDER: 'RADIOLOGY',
  PHARMACY_ORDER: 'PHARMACY',
  SUBSCRIPTION: 'SUBSCRIPTION',
};

export interface CouponLike {
  type: DiscountType;
  value: number;
  maxDiscount: number | null;
  minOrder: number | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  usedCount: number;
  providerId: string | null;
  serviceType: string | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
}

export class CouponError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Discount a coupon gives on `amount`. Throws CouponError with a user-facing Arabic
 * message when it does not apply. Null serviceType = any patient service (never subscriptions).
 */
export function couponDiscount(
  c: CouponLike,
  ctx: { amount: number; serviceType: ServiceType; providerId: string; userUses: number; now?: Date },
): number {
  const now = ctx.now ?? new Date();
  if (!c.isActive) throw new CouponError('COUPON_INACTIVE', 'كود الخصم غير مفعل');
  if (c.startsAt && now < new Date(c.startsAt)) throw new CouponError('COUPON_NOT_STARTED', 'كود الخصم لم يبدأ بعد');
  if (c.expiresAt && now > new Date(c.expiresAt)) throw new CouponError('COUPON_EXPIRED', 'انتهت صلاحية كود الخصم');
  if (c.usageLimit != null && c.usedCount >= c.usageLimit) throw new CouponError('COUPON_USED_UP', 'تم استخدام كود الخصم بالكامل');
  if (c.perUserLimit != null && ctx.userUses >= c.perUserLimit) throw new CouponError('COUPON_USER_LIMIT', 'استخدمت كود الخصم من قبل');
  const forSubscriptions = c.serviceType === 'SUBSCRIPTION';
  if (forSubscriptions !== (ctx.serviceType === 'SUBSCRIPTION') || (c.serviceType && c.serviceType !== ctx.serviceType)) {
    throw new CouponError('COUPON_NOT_APPLICABLE', 'كود الخصم لا ينطبق على هذه الخدمة');
  }
  if (c.providerId && c.providerId !== ctx.providerId) throw new CouponError('COUPON_NOT_APPLICABLE', 'كود الخصم خاص بمقدم خدمة آخر');
  if (c.minOrder != null && ctx.amount < Number(c.minOrder)) throw new CouponError('COUPON_MIN_ORDER', `الحد الأدنى لاستخدام الكود ${Number(c.minOrder)} ج.م`);
  let d = c.type === DiscountType.PERCENTAGE ? (ctx.amount * Number(c.value)) / 100 : Number(c.value);
  if (c.maxDiscount != null) d = Math.min(d, Number(c.maxDiscount));
  return round2(Math.max(0, Math.min(d, ctx.amount)));
}

/** Proportional reversal of the commission snapshot for a (partial) refund. */
export function refundSplit(
  commission: { grossAmount: number; commissionAmount: number; providerAmount: number; reversedCommission: number; reversedProviderAmount: number },
  refund: number,
) {
  const gross = Number(commission.grossAmount);
  if (gross <= 0 || refund <= 0) return { commission: 0, provider: 0 };
  const ratio = Math.min(1, refund / gross);
  const leftC = round2(Number(commission.commissionAmount) - Number(commission.reversedCommission));
  const leftP = round2(Number(commission.providerAmount) - Number(commission.reversedProviderAmount));
  const c = Math.min(leftC, round2(Number(commission.commissionAmount) * ratio));
  const p = Math.min(leftP, round2(refund - c));
  return { commission: Math.max(0, c), provider: Math.max(0, p) };
}

/**
 * Provider balance (positive = the platform owes the provider):
 *  + net of online payments the platform collected
 *  − commission on cash/card payments the provider collected
 *  − settlements paid to the provider, + settlements the provider paid
 */
export function providerBalance(x: { onlineNet: number; cashCommission: number; paidToProvider: number; paidToPlatform: number }) {
  return round2(x.onlineNet - x.cashCommission - x.paidToProvider + x.paidToPlatform);
}

const DAY = 86_400_000;

/** A renewal starts when the current period ends (or now, if it already ended). */
export function subscriptionWindow(currentEnd: Date | null, now: Date, durationDays: number, periods: number) {
  const start = currentEnd && currentEnd > now ? currentEnd : now;
  return { start, end: new Date(start.getTime() + durationDays * periods * DAY) };
}

export type SubAccess = 'ACTIVE' | 'GRACE' | 'EXPIRED';

export function subscriptionAccess(end: Date | null, graceDays: number, now: Date = new Date()): SubAccess {
  if (!end) return 'EXPIRED';
  if (now <= end) return 'ACTIVE';
  if (now.getTime() <= end.getTime() + graceDays * DAY) return 'GRACE';
  return 'EXPIRED';
}

export const daysLeft = (end: Date | null, now = new Date()) => (end ? Math.ceil((end.getTime() - now.getTime()) / DAY) : 0);

/** HMAC-SHA256 for the sandbox checkout links (payment id + amount + outcome-free). */
export function signSandbox(secret: string, paymentId: string, amount: number) {
  return createHmac('sha256', secret).update(`${paymentId}:${amount.toFixed(2)}`).digest('hex');
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a || '');
  const y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Paymob "transaction processed" callback HMAC (SHA-512 over the documented fields, in order). */
export const PAYMOB_HMAC_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order.id',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
];

export function paymobHmac(obj: Record<string, any>, secret: string) {
  const get = (path: string) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const str = PAYMOB_HMAC_FIELDS.map((f) => {
    const v = get(f);
    return v === undefined || v === null ? '' : String(v);
  }).join('');
  return createHmac('sha512', secret).update(str).digest('hex');
}
