import { auth, availableSlots, Ctx, createApprovedDoctor, createContext, registerPatient } from './helpers';

describe('Booking engine (integration)', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await createContext();
  });
  afterAll(async () => {
    await ctx?.app.close();
  });

  it('books a slot; the slot then shows as booked', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const [slot] = await availableSlots(ctx, doc.doctorId);
    const res = await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slot.startAt }).expect(201);
    expect(res.body.status).toBe('CONFIRMED');
    expect(res.body.code).toMatch(/^APT-/);
    expect(res.body.finalPrice).toBe(500);
    const after = await availableSlots(ctx, doc.doctorId);
    expect(after.find((s) => s.startAt === slot.startAt)).toBeUndefined();
  });

  it('prevents double booking under concurrency: 10 patients race for one slot, exactly one wins', async () => {
    const doc = await createApprovedDoctor(ctx);
    const patients = await Promise.all(Array.from({ length: 10 }, (_, i) => registerPatient(ctx, `مريض ${i}`)));
    const [slot] = await availableSlots(ctx, doc.doctorId);
    const results = await Promise.all(
      patients.map((p) => ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slot.startAt })),
    );
    const ok = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(conflicts).toHaveLength(9);
    conflicts.forEach((r) => expect(r.body.error).toBe('SLOT_UNAVAILABLE'));
    const [{ count }] = await ctx.ds.query(
      `SELECT count(*)::int FROM appointments WHERE doctor_id = $1 AND start_at = $2 AND status <> 'CANCELLED'`,
      [doc.doctorId, slot.startAt],
    );
    expect(count).toBe(1);
  });

  it('the database itself rejects overlapping active appointments (exclusion constraint)', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p1 = await registerPatient(ctx);
    const p2 = await registerPatient(ctx);
    const [slot] = await availableSlots(ctx, doc.doctorId);
    await ctx.http().post('/api/appointments').set(auth(p1.token)).send({ doctorId: doc.doctorId, startAt: slot.startAt }).expect(201);
    // Bypass the application entirely and try to insert an overlapping row.
    await expect(
      ctx.ds.query(
        `INSERT INTO appointments (code, patient_id, provider_id, doctor_id, start_at, end_at, status, price, final_price, created_by_id)
         VALUES ('RAW-1', $1, $2, $3, $4::timestamptz + interval '10 minutes', $4::timestamptz + interval '40 minutes', 'CONFIRMED', 1, 1, $5)`,
        [p2.user.patientId, doc.providerId, doc.doctorId, slot.startAt, p2.user.id],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23P01' } });
  });

  it('rejects times that are not real slots in the schedule', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const [slot] = await availableSlots(ctx, doc.doctorId);
    const odd = new Date(new Date(slot.startAt).getTime() + 7 * 60_000).toISOString();
    const res = await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: odd }).expect(400);
    expect(res.body.error).toBe('INVALID_SLOT');
    const past = await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: '2020-01-01T10:00:00.000Z' });
    expect(past.status).toBe(400);
  });

  it('a patient cannot hold two appointments at the same time', async () => {
    const d1 = await createApprovedDoctor(ctx);
    const d2 = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const [slot] = await availableSlots(ctx, d1.doctorId);
    await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: d1.doctorId, startAt: slot.startAt }).expect(201);
    const res = await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: d2.doctorId, startAt: slot.startAt }).expect(409);
    expect(res.body.error).toBe('PATIENT_CONFLICT');
  });

  it('unapproved doctors cannot be booked or seen', async () => {
    const [spec] = await ctx.ds.query(`SELECT id FROM specialties WHERE slug='cardiology'`);
    const reg = await ctx
      .http()
      .post('/api/auth/register/doctor')
      .send({ fullName: 'غير معتمد', phone: '01077770001', email: 'pending@test.local', password: 'Passw0rd!', specialtyId: spec.id, qualifications: 'MBBCh', licenseNumber: 'P-1', experienceYears: 1, consultationPrice: 100 })
      .expect(201);
    const doctorId = reg.body.user.doctorId;
    await ctx.http().get(`/api/doctors/${doctorId}`).expect(404);
    await ctx.http().get(`/api/doctors/${doctorId}/availability`).expect(404);
    const p = await registerPatient(ctx);
    await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId, startAt: new Date(Date.now() + 86400_000).toISOString() }).expect(400);
  });

  it('cancellation frees the slot; other users cannot see or cancel it', async () => {
    const doc = await createApprovedDoctor(ctx, { cancellationWindowHours: 0 });
    const p = await registerPatient(ctx);
    const intruder = await registerPatient(ctx);
    const [slot] = await availableSlots(ctx, doc.doctorId);
    const a = (await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slot.startAt }).expect(201)).body;
    await ctx.http().get(`/api/appointments/${a.id}`).set(auth(intruder.token)).expect(404);
    await ctx.http().patch(`/api/appointments/${a.id}/cancel`).set(auth(intruder.token)).send({}).expect(404);
    const c = await ctx.http().patch(`/api/appointments/${a.id}/cancel`).set(auth(p.token)).send({ reason: 'ظرف طارئ' }).expect(200);
    expect(c.body.status).toBe('CANCELLED');
    await ctx.http().patch(`/api/appointments/${a.id}/cancel`).set(auth(p.token)).send({}).expect(400);
    const after = await availableSlots(ctx, doc.doctorId);
    expect(after.find((s) => s.startAt === slot.startAt)).toBeDefined();
    // somebody else can now take it
    await ctx.http().post('/api/appointments').set(auth(intruder.token)).send({ doctorId: doc.doctorId, startAt: slot.startAt }).expect(201);
  });

  it('enforces the doctor cancellation window for patients (not for the doctor)', async () => {
    const doc = await createApprovedDoctor(ctx, { cancellationWindowHours: 72 });
    const p = await registerPatient(ctx);
    const [slot] = await availableSlots(ctx, doc.doctorId, 2);
    const a = (await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slot.startAt }).expect(201)).body;
    expect(a.canCancel).toBe(false);
    await ctx.http().patch(`/api/appointments/${a.id}/cancel`).set(auth(p.token)).send({}).expect(400);
    await ctx.http().patch(`/api/appointments/${a.id}/cancel`).set(auth(doc.token)).send({ reason: 'الطبيب معتذر' }).expect(200);
  });

  it('reschedule moves the booking, frees the old slot and links both records', async () => {
    const doc = await createApprovedDoctor(ctx, { cancellationWindowHours: 0 });
    const p = await registerPatient(ctx);
    const slots = await availableSlots(ctx, doc.doctorId);
    const a = (await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slots[0].startAt }).expect(201)).body;
    const r = await ctx.http().patch(`/api/appointments/${a.id}/reschedule`).set(auth(p.token)).send({ startAt: slots[3].startAt }).expect(200);
    expect(r.body.rescheduledFromId).toBe(a.id);
    expect(r.body.startAt).toBe(slots[3].startAt);
    const old = await ctx.http().get(`/api/appointments/${a.id}`).set(auth(p.token)).expect(200);
    expect(old.body.status).toBe('RESCHEDULED');
    const avail = await availableSlots(ctx, doc.doctorId);
    expect(avail.find((s) => s.startAt === slots[0].startAt)).toBeDefined();
    expect(avail.find((s) => s.startAt === slots[3].startAt)).toBeUndefined();
  });

  it('reschedule into a taken slot fails and leaves the original intact', async () => {
    const doc = await createApprovedDoctor(ctx, { cancellationWindowHours: 0 });
    const p1 = await registerPatient(ctx);
    const p2 = await registerPatient(ctx);
    const slots = await availableSlots(ctx, doc.doctorId);
    const a = (await ctx.http().post('/api/appointments').set(auth(p1.token)).send({ doctorId: doc.doctorId, startAt: slots[0].startAt }).expect(201)).body;
    await ctx.http().post('/api/appointments').set(auth(p2.token)).send({ doctorId: doc.doctorId, startAt: slots[1].startAt }).expect(201);
    await ctx.http().patch(`/api/appointments/${a.id}/reschedule`).set(auth(p1.token)).send({ startAt: slots[1].startAt }).expect(409);
    const still = await ctx.http().get(`/api/appointments/${a.id}`).set(auth(p1.token)).expect(200);
    expect(still.body.status).toBe('CONFIRMED');
  });

  it('PENDING → CONFIRMED → CHECKED_IN → COMPLETED by the doctor only; invalid jumps rejected', async () => {
    const doc = await createApprovedDoctor(ctx, { autoConfirm: false });
    const other = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const [slot] = await availableSlots(ctx, doc.doctorId);
    const a = (await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slot.startAt }).expect(201)).body;
    expect(a.status).toBe('PENDING');
    await ctx.http().patch(`/api/appointments/${a.id}/status`).set(auth(p.token)).send({ status: 'CONFIRMED' }).expect(403);
    await ctx.http().patch(`/api/appointments/${a.id}/status`).set(auth(other.token)).send({ status: 'CONFIRMED' }).expect(403);
    await ctx.http().patch(`/api/appointments/${a.id}/status`).set(auth(doc.token)).send({ status: 'COMPLETED' }).expect(400);
    await ctx.http().patch(`/api/appointments/${a.id}/status`).set(auth(doc.token)).send({ status: 'CONFIRMED' }).expect(200);
    await ctx.http().patch(`/api/appointments/${a.id}/status`).set(auth(doc.token)).send({ status: 'CHECKED_IN' }).expect(200);
    const done = await ctx.http().patch(`/api/appointments/${a.id}/status`).set(auth(doc.token)).send({ status: 'COMPLETED' }).expect(200);
    expect(done.body.paymentStatus).toBe('PAID');
    expect(done.body.history.map((h: any) => h.toStatus)).toEqual(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED']);
    // review only after completion, only once
    await ctx.http().post('/api/reviews').set(auth(p.token)).send({ appointmentId: a.id, rating: 5 }).expect(201);
    await ctx.http().post('/api/reviews').set(auth(p.token)).send({ appointmentId: a.id, rating: 1 }).expect(409);
    const [prov] = await ctx.ds.query(`SELECT rating_avg::float, rating_count FROM providers WHERE id = $1`, [doc.providerId]);
    expect(prov).toEqual({ rating_avg: 5, rating_count: 1 });
  });

  it('cannot review an appointment that is not completed', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const [slot] = await availableSlots(ctx, doc.doctorId);
    const a = (await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slot.startAt }).expect(201)).body;
    await ctx.http().post('/api/reviews').set(auth(p.token)).send({ appointmentId: a.id, rating: 5 }).expect(400);
  });
});
