import { createHmac } from 'crypto';
import { DiscountType } from '../../src/database/entities/enums';
import { CouponError, couponDiscount, paymobHmac, providerBalance, refundSplit, signSandbox, subscriptionAccess, subscriptionWindow } from '../../src/modules/payments/payments-logic';

const base = { type: DiscountType.PERCENTAGE, value: 20, maxDiscount: null, minOrder: null, usageLimit: null, perUserLimit: null, usedCount: 0, providerId: null, serviceType: null, startsAt: null, expiresAt: null, isActive: true };
const ctx = { amount: 500, serviceType: 'APPOINTMENT' as const, providerId: 'p1', userUses: 0 };
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return (e as CouponError).code;
  }
};

describe('coupons', () => {
  it('percentage with a cap, fixed never above the amount', () => {
    expect(couponDiscount(base, ctx)).toBe(100);
    expect(couponDiscount({ ...base, maxDiscount: 60 }, ctx)).toBe(60);
    expect(couponDiscount({ ...base, type: DiscountType.FIXED, value: 900 }, ctx)).toBe(500);
    expect(couponDiscount({ ...base, value: 12.5 }, { ...ctx, amount: 99.99 })).toBe(12.5);
  });
  it('rejects inactive, not-yet-started, expired, used-up and per-user limits', () => {
    const now = new Date('2026-10-07T10:00:00Z');
    expect(code(() => couponDiscount({ ...base, isActive: false }, ctx))).toBe('COUPON_INACTIVE');
    expect(code(() => couponDiscount({ ...base, startsAt: new Date('2026-10-08') }, { ...ctx, now }))).toBe('COUPON_NOT_STARTED');
    expect(code(() => couponDiscount({ ...base, expiresAt: new Date('2026-10-06') }, { ...ctx, now }))).toBe('COUPON_EXPIRED');
    expect(code(() => couponDiscount({ ...base, usageLimit: 3, usedCount: 3 }, ctx))).toBe('COUPON_USED_UP');
    expect(code(() => couponDiscount({ ...base, perUserLimit: 1 }, { ...ctx, userUses: 1 }))).toBe('COUPON_USER_LIMIT');
  });
  it('scope: service type, provider, minimum order — and patient coupons never pay subscriptions', () => {
    expect(code(() => couponDiscount({ ...base, serviceType: 'LAB' }, ctx))).toBe('COUPON_NOT_APPLICABLE');
    expect(code(() => couponDiscount({ ...base, providerId: 'p2' }, ctx))).toBe('COUPON_NOT_APPLICABLE');
    expect(code(() => couponDiscount({ ...base, minOrder: 600 }, ctx))).toBe('COUPON_MIN_ORDER');
    expect(code(() => couponDiscount(base, { ...ctx, serviceType: 'SUBSCRIPTION' }))).toBe('COUPON_NOT_APPLICABLE');
    expect(couponDiscount({ ...base, serviceType: 'SUBSCRIPTION', value: 50 }, { ...ctx, serviceType: 'SUBSCRIPTION' })).toBe(250);
    expect(code(() => couponDiscount({ ...base, serviceType: 'SUBSCRIPTION' }, ctx))).toBe('COUPON_NOT_APPLICABLE');
  });
});

describe('refunds reverse commission proportionally', () => {
  const c = { grossAmount: 500, commissionAmount: 50, providerAmount: 450, reversedCommission: 0, reversedProviderAmount: 0 };
  it('partial then the rest never exceeds the original split', () => {
    const a = refundSplit(c, 100);
    expect(a).toEqual({ commission: 10, provider: 90 });
    const b = refundSplit({ ...c, reversedCommission: 10, reversedProviderAmount: 90 }, 400);
    expect(b).toEqual({ commission: 40, provider: 360 });
    expect(refundSplit({ ...c, reversedCommission: 50, reversedProviderAmount: 450 }, 10)).toEqual({ commission: 0, provider: 0 });
  });
});

describe('provider balance', () => {
  it('online net owed to the provider minus cash commission owed to the platform, net of settlements', () => {
    expect(providerBalance({ onlineNet: 900, cashCommission: 120, paidToProvider: 500, paidToPlatform: 0 })).toBe(280);
    expect(providerBalance({ onlineNet: 0, cashCommission: 175.2, paidToProvider: 0, paidToPlatform: 100 })).toBe(-75.2);
  });
});

describe('subscription periods', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  it('renewing early stacks on the current period; a lapsed one restarts today', () => {
    const early = subscriptionWindow(new Date('2026-10-20T12:00:00Z'), now, 30, 1);
    expect(early.start.toISOString()).toBe('2026-10-20T12:00:00.000Z');
    expect(early.end.toISOString()).toBe('2026-11-19T12:00:00.000Z');
    const late = subscriptionWindow(new Date('2026-09-01T00:00:00Z'), now, 30, 3);
    expect(late.start).toBe(now);
    expect(late.end.toISOString()).toBe('2027-01-05T12:00:00.000Z');
  });
  it('active → grace → expired', () => {
    const end = new Date('2026-10-05T12:00:00Z');
    expect(subscriptionAccess(end, 3, new Date('2026-10-05T11:00:00Z'))).toBe('ACTIVE');
    expect(subscriptionAccess(end, 3, now)).toBe('GRACE');
    expect(subscriptionAccess(end, 3, new Date('2026-10-08T12:00:01Z'))).toBe('EXPIRED');
    expect(subscriptionAccess(end, 0, now)).toBe('EXPIRED');
    expect(subscriptionAccess(null, 3, now)).toBe('EXPIRED');
  });
});

describe('gateway signatures', () => {
  it('Paymob HMAC concatenates the documented fields in order (SHA-512)', () => {
    const obj = {
      amount_cents: 55000, created_at: '2026-10-07T12:00:00', currency: 'EGP', error_occured: false, has_parent_transaction: false, id: 991,
      integration_id: 12, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false,
      order: { id: 555 }, owner: 77, pending: false, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true,
    };
    const str = '550002026-10-07T12:00:00EGPfalsefalse99112truefalsefalsefalsetruefalse55577false2346MasterCardcardtrue';
    expect(paymobHmac(obj, 'secret')).toBe(createHmac('sha512', 'secret').update(str).digest('hex'));
  });
  it('sandbox links are bound to the payment and the amount', () => {
    expect(signSandbox('k', 'p1', 550)).toBe(signSandbox('k', 'p1', 550));
    expect(signSandbox('k', 'p1', 550)).not.toBe(signSandbox('k', 'p1', 551));
  });
});
