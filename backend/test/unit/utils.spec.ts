import { CommissionScope, DiscountType, ProviderType } from '../../src/database/entities/enums';
import { calculateCommission, pickRule } from '../../src/common/utils/commission';
import { normalizePhone } from '../../src/common/utils/phone';
import { toCsv } from '../../src/modules/dashboards/dashboards.service';
import { SanitizePipe } from '../../src/common/pipes/sanitize.pipe';
import { TRANSITIONS } from '../../src/modules/appointments/appointments.service';
import { AppointmentStatus } from '../../src/database/entities/enums';

describe('commission', () => {
  const rules = [
    { id: 'g', scope: CommissionScope.GLOBAL, type: DiscountType.PERCENTAGE, value: 10 },
    { id: 't', scope: CommissionScope.PROVIDER_TYPE, providerType: ProviderType.LABORATORY, type: DiscountType.PERCENTAGE, value: 15 },
    { id: 'p', scope: CommissionScope.PROVIDER, providerId: 'vip', type: DiscountType.FIXED, value: 30 },
  ];
  it('spec example: 500 EGP @ 10% → doctor 450 / platform 50', () => {
    expect(calculateCommission(500, pickRule(rules, 'any', ProviderType.DOCTOR))).toEqual({ gross: 500, commission: 50, provider: 450, ruleId: 'g' });
  });
  it('most specific rule wins', () => {
    expect(pickRule(rules, 'x', ProviderType.LABORATORY)!.id).toBe('t');
    expect(pickRule(rules, 'vip', ProviderType.LABORATORY)!.id).toBe('p');
  });
  it('fixed commission is capped at the gross amount', () => {
    expect(calculateCommission(20, rules[2]).commission).toBe(20);
  });
  it('rounds to piasters', () => {
    expect(calculateCommission(333.33, rules[0]).commission).toBe(33.33);
  });
  it('no rule → no commission', () => {
    expect(calculateCommission(100, null).provider).toBe(100);
  });
});

describe('phone normalisation', () => {
  it.each([
    ['01012345678', '+201012345678'],
    ['+201012345678', '+201012345678'],
    ['00201012345678', '+201012345678'],
    ['٠١٠١٢٣٤٥٦٧٨', '+201012345678'],
    ['010 1234 5678', '+201012345678'],
  ])('%s → %s', (input, out) => expect(normalizePhone(input)).toBe(out));
  it('rejects garbage', () => expect(normalizePhone('abc')).toBeNull());
});

describe('csv export', () => {
  it('escapes quotes/commas and neutralises formula injection', () => {
    const csv = toCsv([{ a: '=HYPERLINK("x")', b: 'x,y', c: 'ok' }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"x,y"');
  });
});

describe('sanitize pipe', () => {
  const pipe = new SanitizePipe();
  it('strips tags and inline handlers but keeps passwords', () => {
    const out: any = pipe.transform(
      { name: '<script>alert(1)</script>أحمد', bio: '<img src=x onerror=alert(1)>', password: '<keep>me1' },
      { type: 'body' },
    );
    expect(out.name).toBe('alert(1)أحمد');
    expect(out.bio).not.toMatch(/<|onerror/);
    expect(out.password).toBe('<keep>me1');
  });
  it('drops prototype-pollution keys', () => {
    const out: any = pipe.transform(JSON.parse('{"__proto__":{"admin":true},"a":1}'), { type: 'body' });
    expect(({} as any).admin).toBeUndefined();
    expect(out.a).toBe(1);
  });
});

describe('appointment transitions', () => {
  it('cannot complete a PENDING appointment directly', () => {
    expect(TRANSITIONS[AppointmentStatus.PENDING]).not.toContain(AppointmentStatus.COMPLETED);
  });
  it('terminal states have no transitions', () => {
    for (const s of [AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW, AppointmentStatus.RESCHEDULED]) {
      expect(TRANSITIONS[s]).toBeUndefined();
    }
  });
});
