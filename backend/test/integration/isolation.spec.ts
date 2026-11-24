import { auth, availableSlots, Ctx, createApprovedDoctor, createContext, registerPatient } from './helpers';

// Minimal valid 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('Provider isolation, medical records & files (integration)', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await createContext();
  });
  afterAll(async () => {
    await ctx?.app.close();
  });

  it('a doctor only ever sees their own appointments', async () => {
    const d1 = await createApprovedDoctor(ctx);
    const d2 = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const [slot] = await availableSlots(ctx, d1.doctorId);
    const a = (await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: d1.doctorId, startAt: slot.startAt }).expect(201)).body;
    const list1 = await ctx.http().get('/api/appointments?scope=provider').set(auth(d1.token)).expect(200);
    const list2 = await ctx.http().get('/api/appointments?scope=provider').set(auth(d2.token)).expect(200);
    expect(list1.body.items.map((x: any) => x.id)).toContain(a.id);
    expect(list2.body.items).toHaveLength(0);
    // asking for "all" without permission is refused, not silently widened
    await ctx.http().get('/api/appointments?scope=all').set(auth(d2.token)).expect(403);
    await ctx.http().get(`/api/appointments/${a.id}`).set(auth(d2.token)).expect(404);
  });

  it("a doctor cannot edit another provider's profile or branches", async () => {
    const d1 = await createApprovedDoctor(ctx);
    const d2 = await createApprovedDoctor(ctx);
    await ctx.http().patch(`/api/providers/${d1.providerId}`).set(auth(d2.token)).send({ description: 'hacked' }).expect(403);
    await ctx.http().post(`/api/providers/${d1.providerId}/branches`).set(auth(d2.token)).send({ name: 'فرع جديد', address: 'شارع 10' }).expect(403);
    await ctx.http().patch(`/api/providers/${d1.providerId}/branches/${d1.branchId}`).set(auth(d2.token)).send({ name: 'اسم جديد' }).expect(403);
    await ctx.http().patch(`/api/providers/${d1.providerId}`).set(auth(d1.token)).send({ description: 'وصف جديد' }).expect(200);
  });

  it("medical records: patient owns; related doctor may read (audited); unrelated doctor and other patients may not", async () => {
    const related = await createApprovedDoctor(ctx);
    const unrelated = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const other = await registerPatient(ctx);
    const patientId = p.user.patientId;

    await ctx.http().post('/api/patients/me/medical-record/allergies').set(auth(p.token)).send({ allergen: 'البنسلين', severity: 'SEVERE' }).expect(201);
    const own = await ctx.http().get('/api/patients/me/medical-record').set(auth(p.token)).expect(200);
    expect(own.body.record.allergies).toHaveLength(1);

    // no relationship yet
    await ctx.http().get(`/api/patients/${patientId}/medical-record`).set(auth(related.token)).expect(403);
    await ctx.http().get(`/api/patients/${patientId}`).set(auth(related.token)).expect(403);
    // other patient: no permission at all
    await ctx.http().get(`/api/patients/${patientId}/medical-record`).set(auth(other.token)).expect(403);

    // a booking creates the care relationship
    const [slot] = await availableSlots(ctx, related.doctorId);
    await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: related.doctorId, startAt: slot.startAt }).expect(201);
    const rec = await ctx.http().get(`/api/patients/${patientId}/medical-record`).set(auth(related.token)).expect(200);
    expect(rec.body.record.allergies[0].allergen).toBe('البنسلين');
    await ctx.http().get(`/api/patients/${patientId}/medical-record`).set(auth(unrelated.token)).expect(403);

    const [log] = await ctx.ds.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'MEDICAL_RECORD_VIEWED' AND entity_id = $1`,
      [patientId],
    );
    expect(log.n).toBeGreaterThanOrEqual(1);

    // patient cannot edit another patient's record item by id
    const itemId = own.body.record.allergies[0].id;
    await ctx.http().delete(`/api/patients/me/medical-record/allergies/${itemId}`).set(auth(other.token)).expect(404);
  });

  it('explicit consent grant gives a provider access; revoking removes it', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    await ctx.http().get(`/api/patients/${p.user.patientId}/medical-record`).set(auth(doc.token)).expect(403);
    const g = await ctx.http().post('/api/patients/me/access-grants').set(auth(p.token)).send({ providerId: doc.providerId }).expect(201);
    await ctx.http().get(`/api/patients/${p.user.patientId}/medical-record`).set(auth(doc.token)).expect(200);
    await ctx.http().delete(`/api/patients/me/access-grants/${g.body.id}`).set(auth(p.token)).expect(200);
    await ctx.http().get(`/api/patients/${p.user.patientId}/medical-record`).set(auth(doc.token)).expect(403);
  });

  it('private files: content-sniffed on upload; only owner/authorised can download', async () => {
    const p = await registerPatient(ctx);
    const other = await registerPatient(ctx);
    const doc = await createApprovedDoctor(ctx);

    // spoofed extension / type is rejected
    await ctx.http().post('/api/files').set(auth(p.token)).field('purpose', 'MEDICAL_DOCUMENT').attach('file', Buffer.from('#!/bin/sh\nrm -rf /'), { filename: 'scan.png', contentType: 'image/png' }).expect(400);

    const up = await ctx.http().post('/api/files').set(auth(p.token)).field('purpose', 'MEDICAL_DOCUMENT').attach('file', PNG, 'scan.png').expect(201);
    expect(up.body.visibility).toBe('PRIVATE');
    await ctx.http().post('/api/patients/me/documents').set(auth(p.token)).send({ fileId: up.body.id, type: 'REPORT', title: 'تقرير' }).expect(201);

    await ctx.http().get(`/api/files/${up.body.id}`).expect(403); // anonymous
    await ctx.http().get(`/api/files/${up.body.id}`).set(auth(other.token)).expect(403);
    await ctx.http().get(`/api/files/${up.body.id}`).set(auth(doc.token)).expect(403); // no relationship
    const ok = await ctx.http().get(`/api/files/${up.body.id}`).set(auth(p.token)).expect(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.headers['cache-control']).toMatch(/no-store/);

    // other patient cannot attach someone else's file to their record
    await ctx.http().post('/api/patients/me/documents').set(auth(other.token)).send({ fileId: up.body.id, type: 'REPORT', title: 'x' }).expect(400);

    // patients cannot upload provider verification documents
    await ctx.http().post('/api/files').set(auth(p.token)).field('purpose', 'PROVIDER_DOCUMENT').attach('file', PNG, 'id.png').expect(403);
  });

  it('notifications are private to their owner', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const [slot] = await availableSlots(ctx, doc.doctorId);
    await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slot.startAt }).expect(201);
    const mine = await ctx.http().get('/api/notifications').set(auth(doc.token)).expect(200);
    const n = mine.body.items.find((x: any) => x.type === 'APPOINTMENT_NEW');
    expect(n).toBeDefined();
    await ctx.http().patch(`/api/notifications/${n.id}/read`).set(auth(p.token)).expect(404);
    await ctx.http().patch(`/api/notifications/${n.id}/read`).set(auth(doc.token)).expect(200);
  });
});
