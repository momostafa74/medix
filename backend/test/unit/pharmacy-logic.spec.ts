import { FulfillmentType as F, PharmacyOrderStatus as S } from '../../src/database/entities/enums';
import {
  deliveryFeeFor,
  isOpenAt,
  medicineKey,
  medicineLabel,
  nextStatuses,
  orderTotals,
  prescriptionState,
  uncoveredRxItems,
} from '../../src/modules/pharmacy/pharmacy-logic';

const rules = { deliveryAvailable: true, deliveryFee: 20, freeDeliveryOver: 400, minOrderForDelivery: 60 };

describe('delivery fee & totals', () => {
  it('charges the fee, waives it above the threshold, ignores it for pickup', () => {
    expect(deliveryFeeFor(rules, F.DELIVERY, 100)).toBe(20);
    expect(deliveryFeeFor(rules, F.DELIVERY, 400)).toBe(0);
    expect(deliveryFeeFor(rules, F.PICKUP, 10)).toBe(0);
  });
  it('rejects delivery below the minimum or when the pharmacy does not deliver', () => {
    expect(() => deliveryFeeFor(rules, F.DELIVERY, 59.99)).toThrow('BELOW_MINIMUM');
    expect(() => deliveryFeeFor({ ...rules, deliveryAvailable: false }, F.DELIVERY, 500)).toThrow('NO_DELIVERY');
  });
  it('computes totals with cents rounding', () => {
    expect(orderTotals([{ quantity: 3, unitPrice: 33.33 }, { quantity: 1, unitPrice: 0.01 }], rules, F.DELIVERY)).toEqual({ subtotal: 100, deliveryFee: 20, total: 120 });
    expect(orderTotals([], rules, F.DELIVERY)).toEqual({ subtotal: 0, deliveryFee: 0, total: 0 });
  });
});

describe('order state machine', () => {
  it('pickup skips "out for delivery"', () => {
    expect(nextStatuses(S.READY, F.PICKUP)).toEqual([S.DELIVERED]);
    expect(nextStatuses(S.READY, F.DELIVERY)).toEqual([S.OUT_FOR_DELIVERY]);
    expect(nextStatuses(S.OUT_FOR_DELIVERY, F.DELIVERY)).toEqual([S.DELIVERED]);
  });
  it('confirmation is not a manual transition and terminal states have none', () => {
    expect(nextStatuses(S.PENDING, F.DELIVERY)).toEqual([]);
    expect(nextStatuses(S.DELIVERED, F.DELIVERY)).toEqual([]);
    expect(nextStatuses(S.CANCELLED, F.PICKUP)).toEqual([]);
  });
});

describe('prescription lifecycle', () => {
  const now = new Date('2026-10-07T21:30:00Z'); // 00:30 on Oct 8 in Cairo
  it('revoked > dispensed > expired > active', () => {
    expect(prescriptionState({ revokedAt: now, dispensedAt: now, validUntil: '2030-01-01' }, now)).toBe('REVOKED');
    expect(prescriptionState({ revokedAt: null, dispensedAt: now, validUntil: '2020-01-01' }, now)).toBe('DISPENSED');
    expect(prescriptionState({ revokedAt: null, dispensedAt: null, validUntil: '2026-10-08' }, now)).toBe('ACTIVE');
    expect(prescriptionState({ revokedAt: null, dispensedAt: null, validUntil: null }, now)).toBe('ACTIVE');
  });
  it('expiry uses the clinic calendar day, not UTC', () => {
    // Still Oct 7 in UTC, but already Oct 8 in Cairo.
    expect(prescriptionState({ revokedAt: null, dispensedAt: null, validUntil: '2026-10-07' }, now)).toBe('EXPIRED');
  });
});

describe('prescription coverage', () => {
  const cart = [
    { medicineId: 'a', name: 'Augmentin', requiresPrescription: true },
    { medicineId: 'p', name: 'Panadol', requiresPrescription: false },
    { medicineId: 'c', name: 'Concor', requiresPrescription: true },
  ];
  it('lists prescription-only items the e-prescription does not include', () => {
    expect(uncoveredRxItems(cart, new Set(['a']), false)).toEqual(['Concor']);
    expect(uncoveredRxItems(cart, new Set(['a', 'c']), false)).toEqual([]);
  });
  it('an uploaded paper prescription is reviewed by the pharmacist instead', () => {
    expect(uncoveredRxItems(cart, new Set(), true)).toEqual([]);
  });
});

describe('catalog helpers', () => {
  it('builds display names without repeating the strength', () => {
    expect(medicineLabel({ nameEn: 'Concor 5mg', strength: '5mg', form: 'Tablets' })).toBe('Concor 5mg Tablets');
    expect(medicineLabel({ nameEn: 'Cidophage 850', strength: '850mg', form: 'Tablets' })).toBe('Cidophage 850 Tablets');
    expect(medicineLabel({ nameEn: 'Brufen', strength: '400mg', form: 'Tablets' })).toBe('Brufen 400mg Tablets');
    expect(medicineLabel({ nameEn: 'X 1000', strength: '100mg' })).toBe('X 1000 100mg');
    expect(medicineLabel({ nameEn: 'Cream', strength: 'Forte' })).toBe('Cream Forte');
  });
  it('dedupe key ignores case and spacing', () => {
    expect(medicineKey({ nameEn: 'panadol  extra', strength: '500 mg', form: 'tablets' })).toBe(medicineKey({ nameEn: 'Panadol Extra', strength: '500mg', form: 'Tablets' }));
    expect(medicineKey({ nameEn: 'Panadol', strength: '500mg' })).not.toBe(medicineKey({ nameEn: 'Panadol', strength: '1g' }));
  });
  it('open-now respects the clinic timezone and 24h pharmacies', () => {
    const hours = [{ day: 3, open: 540, close: 1440 }]; // Wednesday 09:00–24:00
    expect(isOpenAt(hours, new Date('2026-10-07T20:00:00Z'), 'Africa/Cairo')).toBe(true); // Wed 23:00 Cairo
    expect(isOpenAt(hours, new Date('2026-10-07T21:30:00Z'), 'Africa/Cairo')).toBe(false); // Thu 00:30 Cairo
    expect(isOpenAt(null, new Date(), 'Africa/Cairo', true)).toBe(true);
  });
});
