import { DateTime } from 'luxon';
import { accessionNumber, buildExamSlots, dicomName, studyUidFrom } from '../../src/modules/radiology/radiology-logic';

describe('radiology exam slots', () => {
  const tz = 'Africa/Cairo';
  const now = DateTime.fromISO('2026-10-05T07:00', { zone: tz }).toJSDate(); // Monday
  const at = (hhmm: string, date = '2026-10-06') => DateTime.fromISO(`${date}T${hhmm}`, { zone: tz }).toJSDate();
  const base = { tz, stepMinutes: 15, durationMinutes: 45, units: 1, busy: [] as { start: Date; end: Date }[], now, minLeadMinutes: 30, horizonDays: 30, date: '2026-10-06' };
  const hours = [{ day: 2, open: 540, close: 660 }]; // Tuesday 09:00–11:00
  const hm = (iso: string) => DateTime.fromISO(iso).setZone(tz).toFormat('HH:mm');

  it('only offers starts where the whole exam fits before closing', () => {
    const s = buildExamSlots({ ...base, hours });
    expect(s.map((x) => hm(x.startAt))).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00', '10:15']);
    expect(hm(s[s.length - 1].endAt)).toBe('11:00');
  });

  it('blocks every start that overlaps an exam on a single machine', () => {
    const busy = [{ start: at('09:30'), end: at('10:15') }];
    const s = buildExamSlots({ ...base, hours, busy });
    const free = s.filter((x) => x.remaining > 0).map((x) => hm(x.startAt));
    // 09:00–09:45 overlaps 09:30; 09:45 … 10:00 overlap; 10:15 starts exactly when it ends.
    expect(free).toEqual(['10:15']);
  });

  it('allows parallel exams up to the number of machines', () => {
    const busy = [{ start: at('09:00'), end: at('09:45') }];
    const two = buildExamSlots({ ...base, hours, busy, units: 2 });
    expect(two.find((x) => hm(x.startAt) === '09:00')!.remaining).toBe(1);
    const zero = buildExamSlots({ ...base, hours, units: 0 });
    expect(zero).toEqual([]);
  });

  it('aligns odd opening times to the step grid and respects lead time / horizon', () => {
    const s = buildExamSlots({ ...base, hours: [{ day: 2, open: 545, close: 660 }], durationMinutes: 15 });
    expect(hm(s[0].startAt)).toBe('09:15');
    expect(buildExamSlots({ ...base, hours: [{ day: 1, open: 420, close: 540 }], date: '2026-10-05', durationMinutes: 15 }).map((x) => hm(x.startAt))[0]).toBe('07:30');
    expect(buildExamSlots({ ...base, hours, horizonDays: 0 })).toEqual([]);
  });
});

describe('DICOM identifiers', () => {
  it('derives a valid 2.25 Study Instance UID (digits and dots, ≤ 64 chars)', () => {
    const uid = studyUidFrom('ffffffff-ffff-ffff-ffff-ffffffffffff');
    expect(uid).toBe(`2.25.${(2n ** 128n - 1n).toString()}`);
    expect(uid.length).toBeLessThanOrEqual(64);
    expect(uid).toMatch(/^2\.25\.[1-9]\d*$/);
  });
  it('builds short deterministic accession numbers and DICOM person names', () => {
    const a = accessionNumber('3f2504e0-4f89-11d3-9a0c-0305e82c3301', new Date('2026-10-06T08:00:00Z'));
    expect(a).toMatch(/^A261006[0-9A-F]{6}$/);
    expect(a.length).toBeLessThanOrEqual(16);
    expect(accessionNumber('3f2504e0-4f89-11d3-9a0c-0305e82c3301', new Date('2026-10-06T08:00:00Z'))).toBe(a);
    expect(dicomName('محمد علي إبراهيم')).toBe('إبراهيم^محمد علي');
    expect(dicomName('Mona')).toBe('Mona');
  });
});
