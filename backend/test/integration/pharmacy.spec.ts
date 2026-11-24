import { adminToken, auth, availableSlots, Ctx, createApprovedDoctor, createContext, login, registerPatient, uniquePhone } from './helpers';

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: 0, close: 1440 }));
// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let n = 0;

async function createPharmacy(ctx: Ctx, rules: Record<string, unknown> = {}) {
  const phone = uniquePhone();
  const res = await ctx
    .http()
    .post('/api/auth/register/provider')
    .send({ type: 'PHARMACY', fullName: 'مدير صيدلية', phone, email: `ph${Date.now()}${n++}@test.local`, password: 'Passw0rd!', nameAr: `صيدلية ${n}`, homeService: true, branch: { name: 'الفرع', address: 'شارع الصيدلية 1' } })
    .expect(201);
  const token = res.body.accessToken as string;
  const providerId = res.body.user.providers[0].id as string;
  const admin = await adminToken(ctx);
  await ctx.http().patch(`/api/admin/providers/${providerId}/status`).set(auth(admin)).send({ action: 'APPROVE' }).expect(200);
  const me = await ctx.http().get('/api/pharmacy/me').set(auth(token)).expect(200);
  await ctx.http().put(`/api/pharmacy/me/branches/${me.body.branches[0].id}/hours`).set(auth(token)).send({ openingHours: ALL_DAY }).expect(200);
  await ctx.http().patch('/api/pharmacy/me').set(auth(token)).send({ deliveryAvailable: true, deliveryFee: 20, freeDeliveryOver: 500, minOrderForDelivery: 50, ...rules }).expect(200);
  return { token, providerId, pharmacyId: me.body.id as string, branchId: me.body.branches[0].id as string, phone };
}

async function medicine(ctx: Ctx, body: Record<string, unknown>) {
  const admin = await adminToken(ctx);
  return (await ctx.http().post('/api/admin/medicines').set(auth(admin)).send({ nameEn: `Med ${Date.now()}-${n++}`, ...body }).expect(201)).body as { id: string; nameEn: string };
}

async function stock(ctx: Ctx, ph: { token: string }, medicineId: string, price: number, quantity: number | null = null) {
  return (await ctx.http().post('/api/pharmacy/me/inventory').set(auth(ph.token)).send({ medicineId, price, quantity }).expect(201)).body.id as string;
}

/** A doctor with a real appointment with the patient (care relationship). */
async function doctorFor(ctx: Ctx, patientToken: string) {
  const doc = await createApprovedDoctor(ctx);
  const [slot] = await availableSlots(ctx, doc.doctorId);
  await ctx.http().post('/api/appointments').set(auth(patientToken)).send({ doctorId: doc.doctorId, startAt: slot.startAt }).expect(201);
  return doc;
}

async function patientId(ctx: Ctx, token: string) {
  return (await ctx.http().get('/api/patients/me').set(auth(token)).expect(200)).body.id as string;
}

function writeRx(ctx: Ctx, doctorToken: string, patient: string, items: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return ctx
    .http()
    .post('/api/prescriptions')
    .set(auth(doctorToken))
    .send({ patientId: patient, diagnosis: 'تشخيص', items: items.map((i) => ({ dose: 'قرص', frequency: 'مرتين', duration: '5 أيام', ...i })), ...extra });
}

function order(ctx: Ctx, token: string, body: Record<string, unknown>) {
  return ctx.http().post('/api/pharmacy-orders').set(auth(token)).send({ fulfillment: 'PICKUP', ...body });
}

describe('Prescriptions & pharmacy (integration)', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await createContext();
  });
  afterAll(async () => {
    await ctx?.app.close();
  });

  it('doctor writes an e-prescription only for a patient they treat; privacy for everyone else', async () => {
    const p = await registerPatient(ctx);
    const pid = await patientId(ctx, p.token);
    const stranger = await createApprovedDoctor(ctx);
    const med = await medicine(ctx, { requiresPrescription: true });
    await writeRx(ctx, stranger.token, pid, [{ medicineId: med.id }]).expect(403);
    const doc = await doctorFor(ctx, p.token);
    const rx = (await writeRx(ctx, doc.token, pid, [{ medicineId: med.id, quantity: 2 }, { medicineName: 'Free text drops' }]).expect(201)).body;
    expect(rx).toMatchObject({ state: 'ACTIVE', viewer: 'AUTHOR' });
    expect(rx.items.map((i: any) => i.medicineName)).toEqual([med.nameEn, 'Free text drops']);
    // Patient sees it; another patient and the platform team do not.
    const mine = await ctx.http().get('/api/prescriptions/mine').set(auth(p.token)).expect(200);
    expect(mine.body.items.map((x: any) => x.id)).toContain(rx.id);
    const other = await registerPatient(ctx);
    await ctx.http().get(`/api/prescriptions/${rx.id}`).set(auth(other.token)).expect(404);
    const adm = await adminToken(ctx);
    await ctx.http().get(`/api/prescriptions/${rx.id}`).set(auth(adm)).expect(404);
    // Public QR page: authenticity only.
    const v = await ctx.http().get(`/api/verify/${rx.verificationCode}`).expect(200);
    expect(v.body).toMatchObject({ valid: true, type: 'PRESCRIPTION', state: 'ACTIVE' });
    expect(JSON.stringify(v.body)).not.toContain(med.nameEn);
    expect(JSON.stringify(v.body)).not.toContain('تشخيص');
    // Only the author revokes.
    await ctx.http().post(`/api/prescriptions/${rx.id}/revoke`).set(auth(stranger.token)).send({ reason: 'x x x' }).expect(403);
    const revoked = await ctx.http().post(`/api/prescriptions/${rx.id}/revoke`).set(auth(doc.token)).send({ reason: 'تغيير العلاج' }).expect(201);
    expect(revoked.body.state).toBe('REVOKED');
  });

  it('pharmacist lookup: QR code opens it, the printed number needs the patient phone, and it dispenses exactly once under a race', async () => {
    const p = await registerPatient(ctx);
    const pid = await patientId(ctx, p.token);
    const doc = await doctorFor(ctx, p.token);
    const med = await medicine(ctx, { requiresPrescription: true });
    const rx = (await writeRx(ctx, doc.token, pid, [{ medicineId: med.id }]).expect(201)).body;
    const ph = await createPharmacy(ctx);
    await stock(ctx, ph, med.id, 55, 10);
    // A patient account cannot use the pharmacist lookup.
    await ctx.http().post('/api/pharmacy-prescriptions/lookup').set(auth(p.token)).send({ code: rx.verificationCode }).expect(403);
    const byQr = await ctx.http().post('/api/pharmacy-prescriptions/lookup').set(auth(ph.token)).send({ code: rx.verificationCode }).expect(201);
    expect(byQr.body.items[0].stock).toMatchObject({ price: 55, inStock: true });
    const noPhone = await ctx.http().post('/api/pharmacy-prescriptions/lookup').set(auth(ph.token)).send({ code: rx.code }).expect(400);
    expect(noPhone.body.error).toBe('PHONE_REQUIRED');
    await ctx.http().post('/api/pharmacy-prescriptions/lookup').set(auth(ph.token)).send({ code: rx.code, phone: '01099999999' }).expect(404);
    await ctx.http().post('/api/pharmacy-prescriptions/lookup').set(auth(ph.token)).send({ code: rx.code, phone: p.user.phone }).expect(201);

    const ph2 = await createPharmacy(ctx);
    const race = await Promise.all([ph, ph2, ph, ph2, ph].map((x) => ctx.http().post('/api/pharmacy-prescriptions/dispense').set(auth(x.token)).send({ code: rx.verificationCode })));
    expect(race.filter((r) => r.status === 201)).toHaveLength(1);
    race.filter((r) => r.status !== 201).forEach((r) => expect(r.status).toBe(409));
    const after = await ctx.http().get(`/api/prescriptions/${rx.id}`).set(auth(p.token)).expect(200);
    expect(after.body.state).toBe('DISPENSED');
    // A dispensed prescription cannot be revoked any more.
    await ctx.http().post(`/api/prescriptions/${rx.id}/revoke`).set(auth(doc.token)).send({ reason: 'متأخر' }).expect(409);
  });

  it('orders are priced from inventory; prescription-only items need a prescription; client prices are rejected', async () => {
    const ph = await createPharmacy(ctx);
    const rxMed = await medicine(ctx, { requiresPrescription: true });
    const otc = await medicine(ctx, {});
    await stock(ctx, ph, rxMed.id, 100, 20);
    await stock(ctx, ph, otc.id, 30);
    const p = await registerPatient(ctx);
    await order(ctx, p.token, { pharmacy: ph.providerId, items: [{ medicineId: otc.id, quantity: 1, unitPrice: 1 }] }).expect(400);
    const blocked = await order(ctx, p.token, { pharmacy: ph.providerId, items: [{ medicineId: rxMed.id, quantity: 1 }] }).expect(400);
    expect(blocked.body.error).toBe('RX_REQUIRED');
    // Delivery rules: below the minimum → refused; fee applied; free above the threshold.
    expect((await order(ctx, p.token, { pharmacy: ph.providerId, fulfillment: 'DELIVERY', deliveryAddress: 'شارع التحرير 10', items: [{ medicineId: otc.id, quantity: 1 }] }).expect(400)).body.error).toBe('BELOW_MINIMUM');
    const d = (await order(ctx, p.token, { pharmacy: ph.providerId, fulfillment: 'DELIVERY', deliveryAddress: 'شارع التحرير 10', items: [{ medicineId: otc.id, quantity: 2 }, { medicineId: otc.id, quantity: 1 }] }).expect(201)).body;
    expect(d).toMatchObject({ subtotal: 90, deliveryFee: 20, total: 110, status: 'PENDING' });
    expect(d.items).toHaveLength(1); // duplicate lines merged
    // Uploaded paper prescription unlocks prescription-only items (the pharmacist reviews it).
    const file = (await ctx.http().post('/api/files').set(auth(p.token)).field('purpose', 'PRESCRIPTION_UPLOAD').attach('file', PNG, 'rx.png').expect(201)).body;
    const withUpload = (await order(ctx, p.token, { pharmacy: ph.providerId, items: [{ medicineId: rxMed.id, quantity: 5 }], prescriptionFileId: file.id }).expect(201)).body;
    expect(withUpload.total).toBe(500);
    // The pharmacy can open the uploaded file; another patient cannot.
    await ctx.http().get(`/api/files/${file.id}`).set(auth(ph.token)).expect(200);
    const stranger = await registerPatient(ctx);
    await ctx.http().get(`/api/files/${file.id}`).set(auth(stranger.token)).expect(403);
  });

  it('stock is reserved atomically on confirmation: concurrent confirmations cannot oversell, cancellation restores it', async () => {
    const ph = await createPharmacy(ctx);
    const med = await medicine(ctx, {});
    const inv = await stock(ctx, ph, med.id, 40, 3);
    const patients = await Promise.all([1, 2, 3].map(() => registerPatient(ctx)));
    const orders = await Promise.all(patients.map(async (p) => (await order(ctx, p.token, { pharmacy: ph.providerId, items: [{ medicineId: med.id, quantity: 2 }] }).expect(201)).body.id as string));
    const confirms = await Promise.all(orders.map((id) => ctx.http().post(`/api/pharmacy-orders/${id}/confirm`).set(auth(ph.token)).send({})));
    expect(confirms.filter((r) => r.status === 201)).toHaveLength(1);
    confirms.filter((r) => r.status !== 201).forEach((r) => expect(r.body.error).toBe('OUT_OF_STOCK'));
    const [row] = await ctx.ds.query(`SELECT quantity, in_stock FROM pharmacy_inventory WHERE id = $1`, [inv]);
    expect(row).toEqual({ quantity: 1, in_stock: true });
    const winner = orders[confirms.findIndex((r) => r.status === 201)];
    await ctx.http().post(`/api/pharmacy-orders/${winner}/cancel`).set(auth(ph.token)).send({}).expect(400); // reason required
    await ctx.http().post(`/api/pharmacy-orders/${winner}/cancel`).set(auth(ph.token)).send({ reason: 'نفد من المورد' }).expect(201);
    const [back] = await ctx.ds.query(`SELECT quantity FROM pharmacy_inventory WHERE id = $1`, [inv]);
    expect(back.quantity).toBe(3);
  });

  it('full e-prescription order: quote priced by the pharmacy, delivered → paid and prescription dispensed; isolation & admin metadata only', async () => {
    const p = await registerPatient(ctx);
    const pid = await patientId(ctx, p.token);
    const doc = await doctorFor(ctx, p.token);
    const a = await medicine(ctx, { requiresPrescription: true });
    const b = await medicine(ctx, { requiresPrescription: true });
    const rx = (await writeRx(ctx, doc.token, pid, [{ medicineId: a.id, quantity: 2 }, { medicineId: b.id }]).expect(201)).body;
    const ph = await createPharmacy(ctx);
    await stock(ctx, ph, a.id, 50, 10);
    await stock(ctx, ph, b.id, 80, 10);
    // Compare pharmacies for the whole prescription.
    const offers = await ctx.http().get(`/api/pharmacy-orders/prescription-offers/${rx.id}`).set(auth(p.token)).expect(200);
    const mineOffer = offers.body.pharmacies.find((x: any) => x.pharmacy.providerId === ph.providerId);
    expect(mineOffer).toMatchObject({ available: 2, subtotal: 180 });
    // Quote order (no items), then a second order on the same prescription is refused while it is open.
    const q = (await order(ctx, p.token, { pharmacy: ph.providerId, items: [], prescriptionId: rx.id, fulfillment: 'DELIVERY', deliveryAddress: 'شارع النيل 5 الدور 2' }).expect(201)).body;
    expect(q.quote).toBe(true);
    expect((await order(ctx, p.token, { pharmacy: ph.providerId, items: [], prescriptionId: rx.id }).expect(409)).body.error).toBe('RX_IN_ORDER');
    // Other pharmacy: not found. Platform: metadata only.
    const other = await createPharmacy(ctx);
    await ctx.http().get(`/api/pharmacy-orders/${q.id}`).set(auth(other.token)).expect(404);
    await ctx.http().post(`/api/pharmacy-orders/${q.id}/confirm`).set(auth(other.token)).send({}).expect(404);
    const adm = await adminToken(ctx);
    const plat = await ctx.http().get(`/api/pharmacy-orders/${q.id}`).set(auth(adm)).expect(200);
    expect(plat.body.viewer).toBe('PLATFORM');
    expect(plat.body.items).toBeUndefined();
    expect(plat.body.prescription).toBeUndefined();
    // Pharmacy sees stock for each prescribed item and prices the quote.
    const view = await ctx.http().get(`/api/pharmacy-orders/${q.id}`).set(auth(ph.token)).expect(200);
    expect(view.body.prescription.items.every((i: any) => i.stock?.inStock)).toBe(true);
    await ctx.http().post(`/api/pharmacy-orders/${q.id}/confirm`).set(auth(ph.token)).send({}).expect(400); // nothing to confirm
    const c = (await ctx.http().post(`/api/pharmacy-orders/${q.id}/confirm`).set(auth(ph.token)).send({ items: [{ medicineId: a.id, quantity: 2 }, { medicineId: b.id, quantity: 1 }] }).expect(201)).body;
    expect(c).toMatchObject({ status: 'CONFIRMED', subtotal: 180, deliveryFee: 20, total: 200 });
    // Patient can no longer cancel once preparing; transitions follow the state machine.
    await ctx.http().post(`/api/pharmacy-orders/${q.id}/status`).set(auth(ph.token)).send({ status: 'READY' }).expect(400);
    for (const status of ['PREPARING', 'READY']) await ctx.http().post(`/api/pharmacy-orders/${q.id}/status`).set(auth(ph.token)).send({ status }).expect(201);
    await ctx.http().post(`/api/pharmacy-orders/${q.id}/cancel`).set(auth(p.token)).send({}).expect(400);
    await ctx.http().post(`/api/pharmacy-orders/${q.id}/status`).set(auth(ph.token)).send({ status: 'OUT_FOR_DELIVERY', driverName: 'علي', driverPhone: '01011112222' }).expect(201);
    const done = (await ctx.http().post(`/api/pharmacy-orders/${q.id}/status`).set(auth(ph.token)).send({ status: 'DELIVERED' }).expect(201)).body;
    expect(done).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID', driverPhone: '+201011112222' });
    expect(done.prescription.state).toBe('DISPENSED');
    const rxAfter = await ctx.http().get(`/api/prescriptions/${rx.id}`).set(auth(p.token)).expect(200);
    expect(rxAfter.body.dispensedBy.nameAr).toBeDefined();
    // The dispensing pharmacy can now open the prescription; the other cannot.
    await ctx.http().get(`/api/prescriptions/${rx.id}`).set(auth(ph.token)).expect(200);
    await ctx.http().get(`/api/prescriptions/${rx.id}`).set(auth(other.token)).expect(404);
    // Dashboard reflects the sale.
    const dash = await ctx.http().get('/api/pharmacy/me/dashboard').set(auth(ph.token)).expect(200);
    expect(dash.body.totals).toMatchObject({ delivered: 1, revenue: 200, prescriptionsDispensed: 1 });
  });

  it('staff cannot change prices; pharmacy-added medicines are deduplicated', async () => {
    const ph = await createPharmacy(ctx);
    const staffPhone = uniquePhone();
    await ctx.http().post(`/api/providers/${ph.providerId}/staff`).set(auth(ph.token)).send({ fullName: 'صيدلي', phone: staffPhone, password: 'Passw0rd!' }).expect(201);
    const staff = await login(ctx, staffPhone, 'Passw0rd!');
    const name = `Dedupe Tabs ${Date.now()}`;
    const first = (await ctx.http().post('/api/pharmacy/me/inventory/new-medicine').set(auth(ph.token)).send({ nameEn: name, strength: '500mg', form: 'Tablets', price: 10 }).expect(201)).body;
    expect(first.createdMedicine).toBe(true);
    const ph2 = await createPharmacy(ctx);
    const second = (await ctx.http().post('/api/pharmacy/me/inventory/new-medicine').set(auth(ph2.token)).send({ nameEn: name.toLowerCase().replace(/ /g, '  '), strength: '500 MG', form: 'tablets', price: 12 }).expect(201)).body;
    expect(second).toMatchObject({ createdMedicine: false, medicineId: first.medicineId });
    await ctx.http().patch(`/api/pharmacy/me/inventory/${first.id}`).set(auth(staff)).send({ price: 1 }).expect(403);
    await ctx.http().patch(`/api/pharmacy/me/inventory/${first.id}`).set(auth(staff)).send({ quantity: 0 }).expect(200);
    const [row] = await ctx.ds.query(`SELECT quantity, in_stock FROM pharmacy_inventory WHERE id = $1`, [first.id]);
    expect(row).toEqual({ quantity: 0, in_stock: false });
    // Out-of-stock items are hidden from the public catalog.
    const pub = await ctx.http().get(`/api/pharmacies/${ph.providerId}/items?search=${encodeURIComponent(name)}`).expect(200);
    expect(pub.body.total).toBe(0);
  });
});
