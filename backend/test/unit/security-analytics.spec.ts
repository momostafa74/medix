import { DateTime } from 'luxon';
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  hotp,
  totp,
  verifyTotp,
} from '../../src/common/utils/totp';
import { describeDevice, lockMinutesLeft } from '../../src/common/utils/security';
import { ageGroup, autoGranularity, bucketKeys, buildCohorts, fillSeries, makeRange, pctChange, previousRange, ratio, yearAgoRange } from '../../src/modules/analytics/analytics-logic';
import { CacheService } from '../../src/common/cache/cache.service';
import { percentile } from '../../src/modules/system/metrics';
import { auditCategoryOf } from '../../src/modules/audit/audit-categories';

const TZ = 'Africa/Cairo';
// RFC 6238 appendix B secret ("12345678901234567890" as ASCII).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it('base32 round-trips and matches the RFC secret encoding', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET).toString()).toBe('12345678901234567890');
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });

  it('produces the RFC test vectors (last 6 digits)', () => {
    // RFC 6238 SHA1 vectors: T=59 → 94287082, T=1111111109 → 07081804, T=2000000000 → 69279037
    expect(totp(RFC_SECRET, 59_000)).toBe('287082');
    expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totp(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
    expect(hotp(RFC_SECRET, 1)).toBe('287082');
  });

  it('accepts ±1 step of clock drift, rejects older codes and garbage, and reports the matched step', () => {
    const at = 1_700_000_000_000;
    const step = Math.floor(at / 30_000);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at), at)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at - 30_000), at)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at + 30_000), at)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, at - 90_000), at)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', at)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', at)).toBeNull();
    expect(verifyTotp(RFC_SECRET, ` ${totp(RFC_SECRET, at).slice(0, 3)} ${totp(RFC_SECRET, at).slice(3)} `, at)).toBe(step);
  });

  it('encrypts secrets at rest (AES-GCM): random IV, wrong key or tampering fails', () => {
    const a = encryptSecret('SECRET', 'key-1');
    const b = encryptSecret('SECRET', 'key-1');
    expect(a).not.toBe(b);
    expect(decryptSecret(a, 'key-1')).toBe('SECRET');
    expect(() => decryptSecret(a, 'key-2')).toThrow();
    const parts = a.split('.');
    parts[3] = Buffer.from('XXXXXX').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), 'key-1')).toThrow();
  });

  it('backup codes are unique, readable and hashed case/format-insensitively', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(hashBackupCode(codes[0])).toBe(hashBackupCode(codes[0].toLowerCase().replace('-', ' ')));
  });
});

describe('Account security helpers', () => {
  it('labels devices in Arabic from the user agent', () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe('Chrome على Windows');
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1')).toBe('Safari على iPhone');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Edge على Windows');
    expect(describeDevice('python-requests/2.31')).toBe('تطبيق');
    expect(describeDevice(null)).toBe('جهاز غير معروف');
  });

  it('computes minutes left on a lock', () => {
    const now = Date.now();
    expect(lockMinutesLeft(new Date(now + 61_000), now)).toBe(2);
    expect(lockMinutesLeft(new Date(now - 1), now)).toBe(0);
    expect(lockMinutesLeft(null, now)).toBe(0);
  });

  it('puts audit actions in reviewer-friendly categories', () => {
    expect(auditCategoryOf('LOGIN_FAILED')).toBe('AUTH');
    expect(auditCategoryOf('TWO_FACTOR_ENABLED')).toBe('AUTH');
    expect(auditCategoryOf('MEDICAL_RECORD_VIEWED')).toBe('MEDICAL_ACCESS');
    expect(auditCategoryOf('LAB_RESULT_VIEWED_BY_PATIENT')).toBe('MEDICAL_ACCESS');
    expect(auditCategoryOf('PAYMENT_REFUNDED')).toBe('FINANCE');
    expect(auditCategoryOf('APPOINTMENT_BOOKED')).toBe('BOOKINGS');
    expect(auditCategoryOf('ROLE_PERMISSIONS_CHANGED')).toBe('ADMIN');
    expect(auditCategoryOf('LAB_TEST_UPDATED')).toBe('CATALOG');
    expect(auditCategoryOf('SOMETHING_ELSE')).toBe('OTHER');
  });
});

describe('Analytics logic', () => {
  it('builds inclusive local-day ranges and the comparison periods', () => {
    const r = makeRange('2026-09-01', '2026-09-30', TZ);
    expect(r.days).toBe(30);
    expect(DateTime.fromJSDate(r.start, { zone: TZ }).toISO()).toContain('2026-09-01T00:00:00');
    expect(DateTime.fromJSDate(r.end, { zone: TZ }).toISODate()).toBe('2026-10-01');
    const p = previousRange(r, TZ);
    expect([p.from, p.to, p.days]).toEqual(['2026-08-02', '2026-08-31', 30]);
    const y = yearAgoRange(r, TZ);
    expect([y.from, y.to]).toEqual(['2025-09-01', '2025-09-30']);
    // Swapped dates are fixed, over-long ranges capped to two years.
    expect(makeRange('2026-09-30', '2026-09-01', TZ).from).toBe('2026-09-01');
    expect(makeRange('2020-01-01', '2026-09-30', TZ).days).toBe(731);
  });

  it('computes % change and ratios safely', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(10, 0)).toBeNull();
    expect(ratio(1, 3)).toBe(33.3);
    expect(ratio(5, 0)).toBe(0);
  });

  it('picks a granularity and fills gaps in series', () => {
    expect(autoGranularity(30)).toBe('day');
    expect(autoGranularity(90)).toBe('week');
    expect(autoGranularity(365)).toBe('month');
    const r = makeRange('2026-09-01', '2026-09-05', TZ);
    const keys = bucketKeys(r, 'day', TZ);
    expect(keys).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
    const filled = fillSeries(keys, [{ bucket: '2026-09-03', n: 4 }], { n: 0 });
    expect(filled.map((x) => x.n)).toEqual([0, 0, 4, 0, 0]);
    // Weeks start on Monday (same as PostgreSQL date_trunc('week')).
    expect(bucketKeys(makeRange('2026-09-01', '2026-09-30', TZ), 'week', TZ)[0]).toBe('2026-08-31');
    expect(bucketKeys(makeRange('2026-01-15', '2026-04-02', TZ), 'month', TZ)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
  });

  it('turns cohort rows into retention percentages', () => {
    const rows = [
      { cohort: '2026-05-01', month: '2026-05-01', patients: 10 },
      { cohort: '2026-05-01', month: '2026-06-01', patients: 4 },
      { cohort: '2026-05-01', month: '2026-08-01', patients: 1 },
      { cohort: '2026-06-01', month: '2026-06-01', patients: 5 },
    ];
    expect(buildCohorts(rows, 3)).toEqual([
      { cohort: '2026-05-01', size: 10, retention: [40, null, 10] },
      { cohort: '2026-06-01', size: 5, retention: [null, null, null] },
    ]);
  });

  it('groups ages', () => {
    expect(ageGroup(5)).toBe('0-17');
    expect(ageGroup(30)).toBe('30-44');
    expect(ageGroup(70)).toBe('60+');
    expect(ageGroup(null)).toBe('unknown');
  });
});

describe('CacheService', () => {
  it('serves hits, expires, single-flights concurrent misses and invalidates by tag', async () => {
    const c = new CacheService();
    let loads = 0;
    const load = () => new Promise<number>((r) => setTimeout(() => r(++loads), 20));
    const [a, b] = await Promise.all([c.wrap('k', 1000, load, ['t']), c.wrap('k', 1000, load, ['t'])]);
    expect([a, b, loads]).toEqual([1, 1, 1]);
    expect(await c.wrap('k', 1000, load, ['t'])).toBe(1);
    c.invalidate('t');
    expect(await c.wrap('k', 1000, load, ['t'])).toBe(2);
    c.set('short', 'x', 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(c.get('short')).toBeUndefined();
    expect(c.stats().hits).toBeGreaterThanOrEqual(1);
  });

  it('percentiles for latency stats', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95)).toBe(100);
    expect(percentile([], 95)).toBe(0);
  });
});
