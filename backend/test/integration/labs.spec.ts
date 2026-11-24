import { DateTime } from 'luxon';
import { adminToken, auth, Ctx, createApprovedDoctor, createContext, login, registerPatient, uniquePhone } from './helpers';

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: 0, close: 1440 }));
const tomorrow = () => DateTime.now().setZone('Africa/Cairo').plus({ days: 1 }).toISODate()!;
let n = 0;

async function createLab(ctx: Ctx, opts: { code?: string; price?: number; capacity?: number; approve?: boolean } = {}) {
  const email = `lab${Date.now()}${n++}@test.local`;
  const res = await ctx
    .http()
    .post('/api/auth/register/provider')
    .send({
      type: 'LABORATORY',
      fullName: 'مدير معمل',
      phone: uniquePhone(),
      email,
      password: 'Passw0rd!',
      nameAr: `معمل تجريبي ${n}`,
      homeService: true,
      branch: { name: 'الفرع الرئيسي', address: 'شارع المعامل 1' },
    })
    .expect(201);
  const token = res.body.accessToken as string;
  const providerId = res.body.user.providers[0].id as string;
  if (opts.approve !== false) {
    const admin = await adminToken(ctx);
    await ctx.http().patch(`/api/admin/providers/${providerId}/status`).set(auth(admin)).send({ action: 'APPROVE' }).expect(200);
  }
  const me = await ctx.http().get('/api/labs/me').set(auth(token)).expect(200);
  const branchId = me.body.branches[0].id;
  await ctx.http().put(`/api/labs/me/branches/${branchId}/hours`).set(auth(token)).send({ openingHours: ALL_DAY }).expect(200);
  await ctx
    .http()
    .patch('/api/labs/me')
    .set(auth(token))
    .send({ slotCapacity: opts.capacity ?? 2, slotMinutes: 30, homeCollection: true, homeCollectionFee: 40, homeSlotCapacity: 1, homeCollectionHours: ALL_DAY })
    .expect(200);
  const hb = await ctx
    .http()
    .post('/api/labs/me/tests')
    .set(auth(token))
    .send({
      code: 'cbc',
      name: 'صورة دم كاملة',
      price: opts.price ?? 120,
      sampleType: 'دم',
      parameters: [
        { name: 'Hemoglobin', unit: 'g/dL', ranges: [{ gender: 'MALE', low: 13.5, high: 17.5, criticalLow: 7, criticalHigh: 20 }, { gender: 'FEMALE', low: 12, high: 15.5, criticalLow: 7, criticalHigh: 20 }] },
        { name: 'WBC', unit: '10^3/uL', ranges: [{ low: 4, high: 11 }] },
      ],
    })
    .expect(201);
  const glu = await ctx
    .http()
    .post('/api/labs/me/tests')
    .set(auth(token))
    .send({ code: 'FBS', name: 'سكر صائم', price: 50, sampleType: 'دم', parameters: [{ name: 'Glucose', unit: 'mg/dL', ranges: [{ low: 70, high: 100, criticalLow: 50, criticalHigh: 400 }] }] })
    .expect(201);
  const urine = await ctx
    .http()
    .post('/api/labs/me/tests')
    .set(auth(token))
    .send({ code: 'URINE', name: 'بول', price: 30, sampleType: 'بول', parameters: [{ name: 'Color', resultType: 'TEXT', ranges: [{ textRange: 'Yellow' }] }] })
    .expect(201);
  const pkg = await ctx.http().post('/api/labs/me/packages').set(auth(token)).send({ name: 'باقة', price: 150, testIds: [hb.body.id, glu.body.id] }).expect(201);
  return { token, providerId, branchId, email, laboratoryId: me.body.id as string, cbc: hb.body, fbs: glu.body, urine: urine.body, pkg: pkg.body };
}

async function slots(ctx: Ctx, providerId: string, branchId: string, mode = 'BRANCH') {
  const r = await ctx.http().get(`/api/labs/${providerId}/slots?date=${tomorrow()}&mode=${mode}${mode === 'BRANCH' ? `&branchId=${branchId}` : ''}`).expect(200);
  return r.body.slots as { startAt: string; remaining: number }[];
}

async function addStaff(ctx: Ctx, lab: Awaited<ReturnType<typeof createLab>>, isAdmin = false) {
  const phone = uniquePhone();
  await ctx.http().post(`/api/providers/${lab.providerId}/staff`).set(auth(lab.token)).send({ fullName: 'فني', phone, password: 'Passw0rd!', isAdmin }).expect(201);
  return login(ctx, phone, 'Passw0rd!');
}

async function setPatientGender(ctx: Ctx, patientId: string, gender: string, dob = '1990-01-01') {
  await ctx.ds.query(`UPDATE patients SET gender = $2, date_of_birth = $3 WHERE id = $1`, [patientId, gender, dob]);
}

function book(ctx: Ctx, token: string, lab: any, startAt: string, body: Record<string, unknown> = {}) {
  return ctx.http().post('/api/lab-orders').set(auth(token)).send({ laboratoryId: lab.laboratoryId, testIds: [lab.cbc.id], mode: 'BRANCH', branchId: lab.branchId, scheduledAt: startAt, ...body });
}

async function advance(ctx: Ctx, token: string, id: string, statuses: string[]) {
  for (const status of statuses) await ctx.http().post(`/api/lab-orders/${id}/status`).set(auth(token)).send({ status }).expect(201);
}

describe('Laboratories (integration)', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await createContext();
  });
  afterAll(async () => {
    await ctx?.app.close();
  });

  it('self-registered labs stay hidden until approved', async () => {
    const lab = await createLab(ctx, { approve: false });
    await ctx.http().get(`/api/labs/${lab.providerId}/catalog`).expect(404);
    const s = await ctx.http().get('/api/lab-tests/search?search=CBC').expect(200);
    expect(s.body.items.flatMap((g: any) => g.offers).some((o: any) => o.providerId === lab.providerId)).toBe(false);
  });

  it('compares prices across labs grouped by test code, cheapest first', async () => {
    const a = await createLab(ctx, { price: 140 });
    const b = await createLab(ctx, { price: 90 });
    const res = await ctx.http().get('/api/lab-tests/search?search=cbc').expect(200);
    const g = res.body.items.find((x: any) => x.code === 'CBC');
    const mine = g.offers.filter((o: any) => [a.providerId, b.providerId].includes(o.providerId));
    expect(mine.map((o: any) => o.price)).toEqual([90, 140]);
    expect(g.minPrice).toBeLessThanOrEqual(90);
  });

  it('prices come from the database; client-sent prices are rejected', async () => {
    const lab = await createLab(ctx);
    const p = await registerPatient(ctx);
    const [s] = await slots(ctx, lab.providerId, lab.branchId);
    await book(ctx, p.token, lab, s.startAt, { total: 1 }).expect(400);
    const ok = await book(ctx, p.token, lab, s.startAt, { testIds: [lab.urine.id], packageIds: [lab.pkg.id] }).expect(201);
    expect(ok.body.total).toBe(180);
    expect(ok.body.status).toBe('NEW_ORDER');
    expect(ok.body.code).toMatch(/^LAB-/);
  });

  it('rejects a test that is already inside a chosen package', async () => {
    const lab = await createLab(ctx);
    const p = await registerPatient(ctx);
    const [s] = await slots(ctx, lab.providerId, lab.branchId);
    const r = await book(ctx, p.token, lab, s.startAt, { packageIds: [lab.pkg.id] }).expect(400);
    expect(r.body.message).toContain('ضمن');
  });

  it('never oversells a window: capacity 2, five patients race, exactly two win', async () => {
    const lab = await createLab(ctx, { capacity: 2 });
    const patients = await Promise.all(Array.from({ length: 5 }, () => registerPatient(ctx)));
    const [s] = await slots(ctx, lab.providerId, lab.branchId);
    const results = await Promise.all(patients.map((p) => book(ctx, p.token, lab, s.startAt)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    const full = results.filter((r) => r.status === 409);
    expect(full).toHaveLength(3);
    full.forEach((r) => expect(r.body.error).toBe('SLOT_FULL'));
    const after = await slots(ctx, lab.providerId, lab.branchId);
    expect(after.find((x) => x.startAt === s.startAt)!.remaining).toBe(0);
  });

  it('rejects times that are not real windows, and home collection needs an address + adds the fee', async () => {
    const lab = await createLab(ctx);
    const p = await registerPatient(ctx);
    const [s] = await slots(ctx, lab.providerId, lab.branchId);
    const odd = new Date(new Date(s.startAt).getTime() + 7 * 60_000).toISOString();
    const bad = await book(ctx, p.token, lab, odd).expect(400);
    expect(bad.body.error).toBe('INVALID_SLOT');
    const [h] = await slots(ctx, lab.providerId, lab.branchId, 'HOME');
    await book(ctx, p.token, lab, h.startAt, { mode: 'HOME', branchId: undefined }).expect(400);
    const ok = await book(ctx, p.token, lab, h.startAt, { mode: 'HOME', branchId: undefined, homeAddress: 'شارع 9، عمارة 3' }).expect(201);
    expect(ok.body.total).toBe(160);
    expect(ok.body.homeCollection).toBe(true);
  });

  it('runs the full workflow with role separation, server-side flags, critical alerts, PDF and verification', async () => {
    const lab = await createLab(ctx);
    const tech = await addStaff(ctx, lab);
    const p = await registerPatient(ctx);
    await setPatientGender(ctx, p.user.patientId, 'FEMALE');
    const [s] = await slots(ctx, lab.providerId, lab.branchId);
    const o = (await book(ctx, p.token, lab, s.startAt, { testIds: [lab.cbc.id, lab.fbs.id] }).expect(201)).body;

    // Patients cannot drive the workflow; illegal jumps are refused.
    await ctx.http().post(`/api/lab-orders/${o.id}/status`).set(auth(p.token)).send({ status: 'PAID' }).expect(403);
    await ctx.http().post(`/api/lab-orders/${o.id}/status`).set(auth(tech)).send({ status: 'PROCESSING' }).expect(400);

    await ctx.http().post(`/api/lab-orders/${o.id}/payment`).set(auth(tech)).send({ paymentMethod: 'CASH' }).expect(201);
    await advance(ctx, tech, o.id, ['SAMPLE_COLLECTED']);
    const detail = await ctx.http().get(`/api/lab-orders/${o.id}`).set(auth(tech)).expect(200);
    expect(detail.body.samples).toHaveLength(1); // both tests share one blood tube
    expect(detail.body.samples[0].barcode).toMatch(/^L\d{10}$/);
    await ctx.http().put(`/api/lab-orders/${o.id}/results`).set(auth(tech)).send({ items: [] }).expect(400); // not processing yet
    await advance(ctx, tech, o.id, ['SAMPLE_RECEIVED', 'PROCESSING']);

    const ws = await ctx.http().get(`/api/lab-orders/${o.id}/worksheet`).set(auth(tech)).expect(200);
    const params = Object.fromEntries(ws.body.tests.flatMap((t: any) => t.parameters).map((x: any) => [x.name, x]));
    expect(params.Hemoglobin.referenceRange).toBe('12 – 15.5'); // female range chosen

    // Partial save keeps PROCESSING; client flags for numeric values are ignored.
    let r = await ctx.http().put(`/api/lab-orders/${o.id}/results`).set(auth(tech)).send({ items: [{ parameterId: params.Hemoglobin.id, value: '16.1', flag: 'NORMAL' }] }).expect(200);
    expect(r.body.status).toBe('PROCESSING');
    await ctx.http().put(`/api/lab-orders/${o.id}/results`).set(auth(tech)).send({ items: [{ parameterId: params.WBC.id, value: 'abc' }] }).expect(400);
    r = await ctx
      .http()
      .put(`/api/lab-orders/${o.id}/results`)
      .set(auth(tech))
      .send({ items: [{ parameterId: params.WBC.id, value: '٧٫٢' }, { parameterId: params.Glucose.id, value: '450' }] })
      .expect(200);
    expect(r.body.status).toBe('RESULT_ENTERED');
    const flags = Object.fromEntries(r.body.tests.flatMap((t: any) => t.parameters).map((x: any) => [x.name, x.flag]));
    expect(flags).toEqual({ Hemoglobin: 'HIGH', WBC: 'NORMAL', Glucose: 'CRITICAL' });
    expect(r.body.result.criticalCount).toBe(1);
    const [alert] = await ctx.ds.query(`SELECT n.* FROM notifications n JOIN providers p ON p.owner_user_id = n.user_id WHERE p.id = $1 AND n.type = 'LAB_CRITICAL_VALUE'`, [lab.providerId]);
    expect(alert.body).toContain('Glucose');

    // Not visible to the patient before approval.
    await ctx.http().get(`/api/lab-orders/${o.id}/results`).set(auth(p.token)).expect(403);
    await ctx.http().get(`/api/lab-orders/${o.id}/report.pdf`).set(auth(p.token)).expect(403);

    await ctx.http().post(`/api/lab-orders/${o.id}/results/submit`).set(auth(tech)).expect(201);
    await ctx.http().put(`/api/lab-orders/${o.id}/results`).set(auth(tech)).send({ items: [{ parameterId: params.WBC.id, value: '5' }] }).expect(400); // locked under review
    await ctx.http().post(`/api/lab-orders/${o.id}/results/approve`).set(auth(tech)).expect(403); // staff role cannot approve
    // Reviewer sends it back, technician resubmits, manager approves.
    await ctx.http().post(`/api/lab-orders/${o.id}/results/return`).set(auth(tech)).send({ note: 'راجع قيمة السكر' }).expect(201);
    await ctx.http().post(`/api/lab-orders/${o.id}/results/submit`).set(auth(tech)).expect(201);
    const ap = await ctx.http().post(`/api/lab-orders/${o.id}/results/approve`).set(auth(lab.token)).expect(201);
    expect(ap.body.status).toBe('APPROVED');

    const [ready] = await ctx.ds.query(`SELECT * FROM notifications WHERE user_id = $1 AND type = 'LAB_RESULT_CRITICAL'`, [p.user.id]);
    expect(ready).toBeTruthy();

    const res = await ctx.http().get(`/api/lab-orders/${o.id}/results`).set(auth(p.token)).expect(200);
    expect(res.body.groups.map((g: any) => g.code).sort()).toEqual(['CBC', 'FBS']);
    expect(res.body.result).toBeUndefined();
    const after = await ctx.http().get(`/api/lab-orders/${o.id}`).set(auth(p.token)).expect(200);
    expect(after.body.status).toBe('DELIVERED'); // first patient view = delivered
    expect(after.body.patient.phone).toBeUndefined();

    const v = await ctx.http().get(`/api/verify/${after.body.result.verificationCode}`).expect(200);
    expect(v.body).toMatchObject({ valid: true, type: 'LAB_REPORT', documentNumber: o.code, testsCount: 2 });
    expect(JSON.stringify(v.body)).not.toMatch(/450|Glucose|مريض تجريبي/);
    expect((await ctx.http().get('/api/verify/notARealCode123').expect(200)).body.valid).toBe(false);

    const pdf = await ctx.http().get(`/api/lab-orders/${o.id}/report.pdf`).set(auth(p.token)).buffer(true).parse((resp, cb) => {
      const chunks: Buffer[] = [];
      resp.on('data', (c: Buffer) => chunks.push(c));
      resp.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    if (pdf.status === 200) {
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      const [row] = await ctx.ds.query(`SELECT pdf_file_id FROM lab_results WHERE order_id = $1`, [o.id]);
      expect(row.pdf_file_id).toBeTruthy();
    } else {
      expect(pdf.status).toBe(503); // no Chromium on this machine
    }
    const audit = await ctx.ds.query(`SELECT action FROM audit_logs WHERE entity_id IN ($1, $2) ORDER BY created_at`, [o.id, ap.body.result.id]);
    expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(['LAB_ORDER_BOOKED', 'LAB_ORDER_PAID', 'LAB_RESULT_APPROVED', 'LAB_RESULTS_RETURNED']));
  });

  it('isolates orders: other labs and other patients see nothing; the platform sees metadata but never results', async () => {
    const lab = await createLab(ctx);
    const other = await createLab(ctx);
    const p = await registerPatient(ctx);
    const stranger = await registerPatient(ctx);
    const [s] = await slots(ctx, lab.providerId, lab.branchId);
    const o = (await book(ctx, p.token, lab, s.startAt).expect(201)).body;
    await ctx.http().get(`/api/lab-orders/${o.id}`).set(auth(other.token)).expect(404);
    await ctx.http().post(`/api/lab-orders/${o.id}/status`).set(auth(other.token)).send({ status: 'PAID' }).expect(404);
    await ctx.http().get(`/api/lab-orders/${o.id}/worksheet`).set(auth(other.token)).expect(404);
    await ctx.http().get(`/api/lab-orders/${o.id}`).set(auth(stranger.token)).expect(404);
    const otherList = await ctx.http().get('/api/labs/me/orders').set(auth(other.token)).expect(200);
    expect(otherList.body.items.find((x: any) => x.id === o.id)).toBeUndefined();
    const admin = await adminToken(ctx);
    const meta = await ctx.http().get(`/api/lab-orders/${o.id}`).set(auth(admin)).expect(200);
    expect(meta.body.viewer).toBe('PLATFORM');
    expect(meta.body.samples).toBeUndefined();
    await ctx.http().get(`/api/lab-orders/${o.id}/results`).set(auth(admin)).expect(403);
    await ctx.http().get('/api/lab-orders/admin').set(auth(p.token)).expect(403);
    // Lab staff cannot read a patient's full lab history without being the patient's provider…
    const doc = await createApprovedDoctor(ctx);
    await ctx.http().get(`/api/patients/${p.user.patientId}/lab-results`).set(auth(doc.token)).expect(403);
    await ctx.http().get(`/api/patients/${p.user.patientId}/lab-results`).set(auth(p.token)).expect(200);
  });

  it('enforces the four-eyes rule when the lab enables it', async () => {
    const lab = await createLab(ctx);
    await ctx.http().patch('/api/labs/me').set(auth(lab.token)).send({ requireSeparateApprover: true }).expect(200);
    const p = await registerPatient(ctx);
    const [s] = await slots(ctx, lab.providerId, lab.branchId);
    const o = (await book(ctx, p.token, lab, s.startAt, { testIds: [lab.urine.id] }).expect(201)).body;
    await advance(ctx, lab.token, o.id, ['SAMPLE_COLLECTED', 'SAMPLE_RECEIVED', 'PROCESSING']);
    const ws = await ctx.http().get(`/api/lab-orders/${o.id}/worksheet`).set(auth(lab.token)).expect(200);
    const color = ws.body.tests[0].parameters[0];
    const saved = await ctx.http().put(`/api/lab-orders/${o.id}/results`).set(auth(lab.token)).send({ items: [{ parameterId: color.id, value: 'Red', flag: 'HIGH' }] }).expect(200);
    expect(saved.body.tests[0].parameters[0].flag).toBe('HIGH'); // TEXT parameters keep the technician's flag
    await ctx.http().post(`/api/lab-orders/${o.id}/results/submit`).set(auth(lab.token)).expect(201);
    const r = await ctx.http().post(`/api/lab-orders/${o.id}/results/approve`).set(auth(lab.token)).expect(403);
    expect(r.body.message).toContain('غير الذي أدخلها');
    const manager = await addStaff(ctx, lab, true);
    await ctx.http().post(`/api/lab-orders/${o.id}/results/approve`).set(auth(manager)).expect(201);
  });

  it('rejecting a sample creates a replacement tube and sends the order back for re-collection', async () => {
    const lab = await createLab(ctx);
    const p = await registerPatient(ctx);
    const [s] = await slots(ctx, lab.providerId, lab.branchId);
    const o = (await book(ctx, p.token, lab, s.startAt, { testIds: [lab.cbc.id, lab.urine.id] }).expect(201)).body;
    await ctx.http().post(`/api/lab-orders/${o.id}/payment`).set(auth(lab.token)).send({ paymentMethod: 'CARD' }).expect(201);
    await advance(ctx, lab.token, o.id, ['SAMPLE_COLLECTED', 'SAMPLE_RECEIVED']);
    let d = (await ctx.http().get(`/api/lab-orders/${o.id}`).set(auth(lab.token)).expect(200)).body;
    expect(d.samples).toHaveLength(2); // blood + urine
    const blood = d.samples.find((x: any) => x.sampleType === 'دم');
    d = (await ctx.http().post(`/api/lab-orders/${o.id}/samples/${blood.id}/reject`).set(auth(lab.token)).send({ reason: 'عينة متحللة' }).expect(201)).body;
    expect(d.status).toBe('PAID');
    expect(d.samples).toHaveLength(3);
    // Patient cannot cancel after collection started? They can again now (back to PAID), lab re-collects only the new tube.
    await advance(ctx, lab.token, o.id, ['SAMPLE_COLLECTED']);
    d = (await ctx.http().get(`/api/lab-orders/${o.id}`).set(auth(lab.token)).expect(200)).body;
    expect(d.samples.filter((x: any) => !x.rejectedAt && x.collectedAt)).toHaveLength(2);
    await ctx.http().post(`/api/lab-orders/${o.id}/cancel`).set(auth(p.token)).send({}).expect(400); // sample already collected
    await ctx.http().post(`/api/lab-orders/${o.id}/cancel`).set(auth(lab.token)).send({}).expect(400); // lab must give a reason
    const c = await ctx.http().post(`/api/lab-orders/${o.id}/cancel`).set(auth(lab.token)).send({ reason: 'طلب المريض' }).expect(201);
    expect(c.body.status).toBe('CANCELLED');
  });

  it('team management: only managers add staff; deactivated staff lose access immediately', async () => {
    const lab = await createLab(ctx);
    const phone = uniquePhone();
    await ctx.http().post(`/api/providers/${lab.providerId}/staff`).set(auth(lab.token)).send({ fullName: 'فني 2', phone, password: 'Passw0rd!' }).expect(201);
    const tech = await login(ctx, phone, 'Passw0rd!');
    await ctx.http().post(`/api/providers/${lab.providerId}/staff`).set(auth(tech)).send({ fullName: 'x', phone: uniquePhone(), password: 'Passw0rd!' }).expect(403);
    await ctx.http().get('/api/labs/me/orders').set(auth(tech)).expect(200);
    const list = await ctx.http().get(`/api/providers/${lab.providerId}/staff`).set(auth(lab.token)).expect(200);
    const member = list.body.members.find((m: any) => m.phone.endsWith(phone.slice(-8)));
    await ctx.http().patch(`/api/providers/${lab.providerId}/staff/${member.id}`).set(auth(lab.token)).send({ isActive: false }).expect(200);
    await ctx.http().get('/api/labs/me/orders').set(auth(tech)).expect(403);
  });
});
