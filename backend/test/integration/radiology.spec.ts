import { DateTime } from 'luxon';
import { adminToken, auth, Ctx, createApprovedDoctor, createContext, login, registerPatient, uniquePhone } from './helpers';

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: 0, close: 1440 }));
const tomorrow = () => DateTime.now().setZone('Africa/Cairo').plus({ days: 1 }).toISODate()!;
// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let n = 0;

async function createCenter(ctx: Ctx, opts: { mri?: number } = {}) {
  const res = await ctx
    .http()
    .post('/api/auth/register/provider')
    .send({ type: 'RADIOLOGY', fullName: 'مدير مركز', phone: uniquePhone(), email: `rad${Date.now()}${n++}@test.local`, password: 'Passw0rd!', nameAr: `مركز أشعة ${n}`, branch: { name: 'الفرع', address: 'شارع الأشعة 1' } })
    .expect(201);
  const token = res.body.accessToken as string;
  const providerId = res.body.user.providers[0].id as string;
  const admin = await adminToken(ctx);
  await ctx.http().patch(`/api/admin/providers/${providerId}/status`).set(auth(admin)).send({ action: 'APPROVE' }).expect(200);
  const me = await ctx.http().get('/api/radiology-center/me').set(auth(token)).expect(200);
  const branchId = me.body.branches[0].id;
  await ctx.http().put(`/api/radiology-center/me/branches/${branchId}/hours`).set(auth(token)).send({ openingHours: ALL_DAY }).expect(200);
  await ctx.http().put(`/api/radiology-center/me/branches/${branchId}/modalities`).set(auth(token)).send({ modalities: [{ modality: 'MRI', units: opts.mri ?? 1 }, { modality: 'XRAY', units: 2 }, { modality: 'CT', units: 1 }] }).expect(200);
  const mri = (await ctx.http().post('/api/radiology-center/me/services').set(auth(token)).send({ modality: 'MRI', name: 'رنين ركبة', price: 1800, durationMinutes: 45, reportTemplate: 'Menisci intact.' }).expect(201)).body;
  const xray = (await ctx.http().post('/api/radiology-center/me/services').set(auth(token)).send({ modality: 'XRAY', name: 'أشعة صدر', price: 150, durationMinutes: 15 }).expect(201)).body;
  const ct = (await ctx.http().post('/api/radiology-center/me/services').set(auth(token)).send({ modality: 'CT', name: 'مقطعية بالصبغة', price: 2200, durationMinutes: 30, requiresReferral: true }).expect(201)).body;
  return { token, providerId, branchId, mri, xray, ct };
}

async function slots(ctx: Ctx, c: any, serviceId: string) {
  return (await ctx.http().get(`/api/radiology/${c.providerId}/slots?date=${tomorrow()}&serviceId=${serviceId}&branchId=${c.branchId}`).expect(200)).body.slots as { startAt: string; endAt: string; remaining: number }[];
}

function book(ctx: Ctx, token: string, c: any, serviceId: string, scheduledAt: string, extra: Record<string, unknown> = {}) {
  return ctx.http().post('/api/radiology-orders').set(auth(token)).send({ serviceId, branchId: c.branchId, scheduledAt, ...extra });
}

async function addStaff(ctx: Ctx, c: any, isAdmin = false) {
  const phone = uniquePhone();
  await ctx.http().post(`/api/providers/${c.providerId}/staff`).set(auth(c.token)).send({ fullName: 'أخصائي أشعة', phone, password: 'Passw0rd!', isAdmin }).expect(201);
  return login(ctx, phone, 'Passw0rd!');
}

async function upload(ctx: Ctx, token: string, purpose: string) {
  return (await ctx.http().post('/api/files').set(auth(token)).field('purpose', purpose).attach('file', PNG, 'img.png').expect(201)).body;
}

async function advance(ctx: Ctx, token: string, id: string, statuses: string[]) {
  for (const status of statuses) await ctx.http().post(`/api/radiology-orders/${id}/status`).set(auth(token)).send({ status }).expect(201);
}

describe('Radiology (integration)', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await createContext();
  });
  afterAll(async () => {
    await ctx?.app.close();
  });

  it('exams occupy their full duration on a machine: overlapping starts disappear, one MRI = one patient at a time', async () => {
    const c = await createCenter(ctx, { mri: 1 });
    const before = await slots(ctx, c, c.mri.id);
    const target = before[8];
    const patients = await Promise.all(Array.from({ length: 4 }, () => registerPatient(ctx)));
    const results = await Promise.all(patients.map((p) => book(ctx, p.token, c, c.mri.id, target.startAt)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    results.filter((r) => r.status !== 201).forEach((r) => expect(r.body.error).toBe('SLOT_FULL'));
    const after = await slots(ctx, c, c.mri.id);
    const t = new Date(target.startAt).getTime();
    // Any start within (t-45min, t+45min) overlaps the booked exam.
    for (const s of after) {
      const st = new Date(s.startAt).getTime();
      const overlaps = st < t + 45 * 60_000 && st + 45 * 60_000 > t;
      expect(s.remaining).toBe(overlaps ? 0 : 1);
    }
    // X-ray has its own machines, unaffected.
    expect((await slots(ctx, c, c.xray.id)).every((s) => s.remaining === 2)).toBe(true);
    const ok = results.find((r) => r.status === 201)!;
    expect(ok.body).toMatchObject({ status: 'BOOKED', price: 1800, modality: 'MRI' });
    expect(new Date(ok.body.endAt).getTime() - new Date(ok.body.scheduledAt).getTime()).toBe(45 * 60_000);
  });

  it('requires a referral (owned by the patient) when the service says so, and refuses client prices', async () => {
    const c = await createCenter(ctx);
    const p = await registerPatient(ctx);
    const other = await registerPatient(ctx);
    const [s] = await slots(ctx, c, c.ct.id);
    await book(ctx, p.token, c, c.ct.id, s.startAt, { price: 1 }).expect(400);
    const r = await book(ctx, p.token, c, c.ct.id, s.startAt).expect(400);
    expect(r.body.message).toContain('تحويل');
    const foreign = await upload(ctx, other.token, 'REFERRAL');
    await book(ctx, p.token, c, c.ct.id, s.startAt, { referralFileId: foreign.id }).expect(400);
    const mine = await upload(ctx, p.token, 'REFERRAL');
    const ok = await book(ctx, p.token, c, c.ct.id, s.startAt, { referralFileId: mine.id, clinicalIndication: 'ألم بالبطن' }).expect(201);
    expect(ok.body.price).toBe(2200);
    // The center can open the referral; an unrelated patient cannot.
    await ctx.http().get(`/api/files/${mine.id}`).set(auth(c.token)).expect(200);
    await ctx.http().get(`/api/files/${mine.id}`).set(auth(other.token)).expect(403);
    // Same patient cannot hold two overlapping exams.
    const [x] = (await slots(ctx, c, c.xray.id)).filter((z) => z.startAt === s.startAt);
    const clash = await book(ctx, p.token, c, c.xray.id, x.startAt).expect(409);
    expect(clash.body.error).toBe('PATIENT_CONFLICT');
  });

  it('runs check-in → exam → report → approval with DICOM identifiers, images, PDF and verification', async () => {
    const c = await createCenter(ctx);
    const rad = await addStaff(ctx, c);
    const p = await registerPatient(ctx);
    const [s] = await slots(ctx, c, c.mri.id);
    const o = (await book(ctx, p.token, c, c.mri.id, s.startAt).expect(201)).body;

    await ctx.http().post(`/api/radiology-orders/${o.id}/status`).set(auth(p.token)).send({ status: 'CHECKED_IN' }).expect(403);
    await ctx.http().post(`/api/radiology-orders/${o.id}/status`).set(auth(rad)).send({ status: 'REPORTING' }).expect(400);
    await ctx.http().put(`/api/radiology-orders/${o.id}/report`).set(auth(rad)).send({ findings: 'x', impression: 'y' }).expect(400);

    await advance(ctx, rad, o.id, ['CHECKED_IN']);
    let d = (await ctx.http().get(`/api/radiology-orders/${o.id}`).set(auth(rad)).expect(200)).body;
    expect(d.accessionNumber).toMatch(/^A\d{6}[0-9A-F]{6}$/);
    expect(d.studyInstanceUid).toMatch(/^2\.25\.\d+$/);
    expect(d.reportTemplate).toBe('Menisci intact.');
    const wl = (await ctx.http().get('/api/radiology-center/me/worklist?date=' + tomorrow()).set(auth(rad)).expect(200)).body;
    expect(wl.find((x: any) => x._orderId === o.id)).toMatchObject({ AccessionNumber: d.accessionNumber, StudyInstanceUID: d.studyInstanceUid, ScheduledProcedureStepSequence: [expect.objectContaining({ Modality: 'MR', ScheduledProcedureStepID: o.code })] });

    await advance(ctx, rad, o.id, ['EXAMINATION']);
    const img = await upload(ctx, rad, 'RADIOLOGY_IMAGE');
    await ctx.http().post(`/api/radiology-orders/${o.id}/files`).set(auth(rad)).send({ fileId: img.id, caption: 'Sagittal PD' }).expect(201);
    // Patient cannot see images before approval.
    await ctx.http().get(`/api/files/${img.id}`).set(auth(p.token)).expect(403);
    await advance(ctx, rad, o.id, ['REPORTING']);

    await ctx.http().post(`/api/radiology-orders/${o.id}/report/submit`).set(auth(rad)).expect(400); // nothing saved yet
    await ctx.http().put(`/api/radiology-orders/${o.id}/report`).set(auth(rad)).send({ findings: 'Complex tear of the medial meniscus.', impression: 'Medial meniscal tear.', critical: true }).expect(200);
    d = (await ctx.http().get(`/api/radiology-orders/${o.id}`).set(auth(p.token)).expect(200)).body;
    expect(d.report).toBeNull(); // draft hidden from patient
    expect(d.images).toEqual([]);
    expect(d.accessionNumber).toBeNull();
    await ctx.http().post(`/api/radiology-orders/${o.id}/report/submit`).set(auth(rad)).expect(201);
    await ctx.http().put(`/api/radiology-orders/${o.id}/report`).set(auth(rad)).send({ findings: 'changed after submit', impression: 'z' }).expect(400);
    await ctx.http().post(`/api/radiology-orders/${o.id}/report/approve`).set(auth(rad)).expect(403); // staff cannot approve
    await ctx.http().post(`/api/radiology-orders/${o.id}/report/return`).set(auth(c.token)).send({ note: 'أضف المقاسات' }).expect(201);
    await ctx.http().put(`/api/radiology-orders/${o.id}/report`).set(auth(rad)).send({ findings: 'Complex tear of the medial meniscus, 12 mm.', impression: 'Medial meniscal tear.', critical: true }).expect(200);
    await ctx.http().post(`/api/radiology-orders/${o.id}/report/submit`).set(auth(rad)).expect(201);
    const ap = await ctx.http().post(`/api/radiology-orders/${o.id}/report/approve`).set(auth(c.token)).expect(201);
    expect(ap.body.status).toBe('APPROVED');

    const [note] = await ctx.ds.query(`SELECT * FROM notifications WHERE user_id = $1 AND type = 'RADIOLOGY_REPORT_CRITICAL'`, [p.user.id]);
    expect(note).toBeTruthy();
    d = (await ctx.http().get(`/api/radiology-orders/${o.id}`).set(auth(p.token)).expect(200)).body;
    expect(d.report).toMatchObject({ impression: 'Medial meniscal tear.', critical: true });
    expect(d.report.returnNote).toBeNull();
    expect(d.images).toHaveLength(1);
    await ctx.http().get(`/api/files/${img.id}`).set(auth(p.token)).expect(200);
    await ctx.http().post(`/api/radiology-orders/${o.id}/report/viewed`).set(auth(p.token)).expect(201);
    expect((await ctx.http().get(`/api/radiology-orders/${o.id}`).set(auth(p.token)).expect(200)).body.status).toBe('DELIVERED');

    const v = (await ctx.http().get(`/api/verify/${d.report.verificationCode}`).expect(200)).body;
    expect(v).toMatchObject({ valid: true, type: 'RADIOLOGY_REPORT', documentNumber: o.code });
    expect(JSON.stringify(v)).not.toMatch(/meniscus|tear/i);

    const pdf = await ctx.http().get(`/api/radiology-orders/${o.id}/report.pdf`).set(auth(p.token)).buffer(true).parse((resp, cb) => {
      const chunks: Buffer[] = [];
      resp.on('data', (x: Buffer) => chunks.push(x));
      resp.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    if (pdf.status === 200) expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    else expect(pdf.status).toBe(503);

    const hist = (await ctx.http().get(`/api/patients/${p.user.patientId}/radiology-reports`).set(auth(p.token)).expect(200)).body;
    expect(hist[0]).toMatchObject({ code: o.code, critical: true, images: 1 });
  });

  it('isolates bookings: other centers 404, platform sees metadata only, unrelated doctors cannot read reports', async () => {
    const c = await createCenter(ctx);
    const other = await createCenter(ctx);
    const p = await registerPatient(ctx);
    const stranger = await registerPatient(ctx);
    const [s] = await slots(ctx, c, c.xray.id);
    const o = (await book(ctx, p.token, c, c.xray.id, s.startAt).expect(201)).body;
    await ctx.http().get(`/api/radiology-orders/${o.id}`).set(auth(other.token)).expect(404);
    await ctx.http().post(`/api/radiology-orders/${o.id}/status`).set(auth(other.token)).send({ status: 'CHECKED_IN' }).expect(404);
    await ctx.http().get(`/api/radiology-orders/${o.id}`).set(auth(stranger.token)).expect(404);
    const admin = await adminToken(ctx);
    const meta = (await ctx.http().get(`/api/radiology-orders/${o.id}`).set(auth(admin)).expect(200)).body;
    expect(meta.viewer).toBe('PLATFORM');
    expect(meta.report).toBeUndefined();
    expect(meta.clinicalIndication).toBeUndefined();
    await ctx.http().get(`/api/radiology-orders/${o.id}/report.pdf`).set(auth(admin)).expect(403);
    const doc = await createApprovedDoctor(ctx);
    await ctx.http().get(`/api/patients/${p.user.patientId}/radiology-reports`).set(auth(doc.token)).expect(403);
    // The center has a care relationship now → may read the record.
    await ctx.http().get(`/api/patients/${p.user.patientId}/radiology-reports`).set(auth(c.token)).expect(200);
  });

  it('no-show frees the machine; patient may cancel only before check-in; four-eyes rule', async () => {
    const c = await createCenter(ctx);
    await ctx.http().patch('/api/radiology-center/me').set(auth(c.token)).send({ requireSeparateApprover: true }).expect(200);
    const p = await registerPatient(ctx);
    const p2 = await registerPatient(ctx);
    const [s, s2] = await slots(ctx, c, c.mri.id).then((x) => [x[0], x[6]]);
    const a = (await book(ctx, p.token, c, c.mri.id, s.startAt).expect(201)).body;
    await advance(ctx, c.token, a.id, ['NO_SHOW']);
    expect((await slots(ctx, c, c.mri.id)).find((x) => x.startAt === s.startAt)!.remaining).toBe(1);
    const b = (await book(ctx, p2.token, c, c.mri.id, s2.startAt).expect(201)).body;
    await advance(ctx, c.token, b.id, ['CHECKED_IN']);
    await ctx.http().post(`/api/radiology-orders/${b.id}/cancel`).set(auth(p2.token)).send({}).expect(400);
    await advance(ctx, c.token, b.id, ['EXAMINATION', 'REPORTING']);
    await ctx.http().put(`/api/radiology-orders/${b.id}/report`).set(auth(c.token)).send({ findings: 'Normal study of the knee.', impression: 'Normal.' }).expect(200);
    await ctx.http().post(`/api/radiology-orders/${b.id}/report/submit`).set(auth(c.token)).expect(201);
    const r = await ctx.http().post(`/api/radiology-orders/${b.id}/report/approve`).set(auth(c.token)).expect(403);
    expect(r.body.message).toContain('غير الذي كتبه');
    const consultant = await addStaff(ctx, c, true);
    await ctx.http().post(`/api/radiology-orders/${b.id}/report/approve`).set(auth(consultant)).expect(201);
  });
});
