import { adminToken, auth, availableSlots, Ctx, createApprovedDoctor, createContext, login, registerPatient, uniquePhone } from './helpers';

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: 0, close: 1440 }));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let n = 0;

async function createLab(ctx: Ctx) {
  const phone = uniquePhone();
  const res = await ctx
    .http()
    .post('/api/auth/register/provider')
    .send({ type: 'LABORATORY', fullName: 'مدير معمل', phone, email: `lab${Date.now()}${n++}@test.local`, password: 'Passw0rd!', nameAr: `معمل ${n}`, branch: { name: 'الفرع', address: 'شارع المعمل 1' } })
    .expect(201);
  const token = res.body.accessToken as string;
  const providerId = res.body.user.providers[0].id as string;
  const admin = await adminToken(ctx);
  await ctx.http().patch(`/api/admin/providers/${providerId}/status`).set(auth(admin)).send({ action: 'APPROVE' }).expect(200);
  const me = await ctx.http().get('/api/labs/me').set(auth(token)).expect(200);
  await ctx.http().put(`/api/labs/me/branches/${me.body.branches[0].id}/hours`).set(auth(token)).send({ openingHours: ALL_DAY }).expect(200);
  return { token, providerId, phone };
}

/** Moves a provider's period end and runs the sync job (also clears the principal cache). */
async function setEnd(ctx: Ctx, providerId: string, daysFromNow: number) {
  await ctx.ds.query(`UPDATE provider_subscriptions SET current_period_end = now() + make_interval(days => $2::int) WHERE provider_id = $1`, [providerId, daysFromNow]);
  const admin = await adminToken(ctx);
  await ctx.http().post('/api/admin/subscriptions/sync').set(auth(admin)).expect(201);
}

/** Runs the sandbox checkout page: follows the redirect URL and posts the card. */
function paySandbox(ctx: Ctx, redirectUrl: string, card = '4242424242424242'): any {
  const m = redirectUrl.match(/\/pay\/sandbox\/([^?]+)\?sig=(\w+)/)!;
  return ctx.http().post(`/api/payments/sandbox/${m[1]}/complete`).send({ sig: m[2], card });
}

describe('Payments, coupons & subscriptions (integration)', () => {
  let ctx: Ctx;
  let admin: string;
  beforeAll(async () => {
    ctx = await createContext();
    admin = await adminToken(ctx);
  });
  afterAll(async () => {
    await ctx?.app.close();
  });

  it('patients sign up with phone + password only (6+ characters), then complete their name later', async () => {
    const phone = uniquePhone();
    await ctx.http().post('/api/auth/register').send({ phone, password: '12345' }).expect(400);
    const r = await ctx.http().post('/api/auth/register').send({ phone, password: '123456' }).expect(201);
    expect(r.body.user).toMatchObject({ profileCompleted: false, subscription: null });
    expect(r.body.user.fullName).toContain(phone.slice(-4));
    await ctx.http().post('/api/auth/login').send({ identifier: phone, password: '123456' }).expect(200);
    await ctx.http().patch('/api/users/me').set(auth(r.body.accessToken)).send({ fullName: 'منى أحمد' }).expect(200);
    const me = await ctx.http().get('/api/auth/me').set(auth(r.body.accessToken)).expect(200);
    expect(me.body).toMatchObject({ fullName: 'منى أحمد', profileCompleted: true });
    // Providers keep the strong password rule.
    await ctx.http().post('/api/auth/register/provider').send({ type: 'PHARMACY', fullName: 'صيدلي', phone: uniquePhone(), email: `w${Date.now()}@t.local`, password: '123456', nameAr: 'صيدلية', branch: { name: 'ف', address: 'شارع 1' } }).expect(400);
  });

  it('lapsed subscription: providers are locked out (402) and hidden after the grace period, patients never are; online renewal restores access', async () => {
    const lab = await createLab(ctx);
    const pt = await registerPatient(ctx);
    // New providers start on a trial.
    const s0 = await ctx.http().get('/api/subscriptions/me').set(auth(lab.token)).expect(200);
    expect(s0.body.subscription).toMatchObject({ status: 'TRIAL', blocked: false });
    expect(s0.body.plans.length).toBeGreaterThan(0);
    // Within the grace period: still working.
    await setEnd(ctx, lab.providerId, -1);
    await ctx.http().get('/api/labs/me').set(auth(lab.token)).expect(200);
    await ctx.http().get(`/api/labs/${lab.providerId}/catalog`).expect(200);
    // After grace: locked out of the workspace, invisible to patients.
    await setEnd(ctx, lab.providerId, -10);
    const blocked = await ctx.http().get('/api/labs/me').set(auth(lab.token)).expect(402);
    expect(blocked.body.error).toBe('SUBSCRIPTION_REQUIRED');
    await ctx.http().get(`/api/labs/${lab.providerId}/catalog`).expect(404);
    const me = await ctx.http().get('/api/auth/me').set(auth(lab.token)).expect(200);
    expect(me.body.subscription).toMatchObject({ blocked: true, canPay: true });
    // Staff of the lab are blocked too and cannot pay.
    const staffPhone = uniquePhone();
    await ctx.ds.query(`UPDATE provider_subscriptions SET current_period_end = now() + interval '1 day' WHERE provider_id = $1`, [lab.providerId]);
    await ctx.http().post('/api/admin/subscriptions/sync').set(auth(admin)).expect(201);
    await ctx.http().post(`/api/providers/${lab.providerId}/staff`).set(auth(lab.token)).send({ fullName: 'فني', phone: staffPhone, password: 'Passw0rd!' }).expect(201);
    const staff = await login(ctx, staffPhone, 'Passw0rd!');
    await setEnd(ctx, lab.providerId, -10);
    await ctx.http().get('/api/labs/me').set(auth(staff)).expect(402);
    const plan = s0.body.plans[0];
    await ctx.http().post('/api/subscriptions/me/subscribe').set(auth(staff)).send({ planId: plan.id, method: 'ONLINE' }).expect(403);
    // Patients are never affected.
    await ctx.http().get('/api/appointments').set(auth(pt.token)).expect(200);
    // Renewal: tampered checkout link refused, then a real payment re-opens everything.
    const r = (await ctx.http().post('/api/subscriptions/me/subscribe').set(auth(lab.token)).send({ planId: plan.id, method: 'ONLINE', periods: 2 }).expect(201)).body;
    expect(r.status).toBe('REDIRECT');
    const pid = r.redirectUrl.match(/sandbox\/([^?]+)/)[1];
    await ctx.http().post(`/api/payments/sandbox/${pid}/complete`).send({ sig: 'f'.repeat(64), card: '4242424242424242' }).expect(404);
    const declined = await paySandbox(ctx, r.redirectUrl, '4000000000000002').expect(201);
    expect(declined.body.status).toBe('FAILED');
    const r2 = (await ctx.http().post('/api/subscriptions/me/subscribe').set(auth(lab.token)).send({ planId: plan.id, method: 'ONLINE', periods: 2 }).expect(201)).body;
    expect((await paySandbox(ctx, r2.redirectUrl).expect(201)).body.status).toBe('PAID');
    const after = await ctx.http().get('/api/subscriptions/me').set(auth(lab.token)).expect(200);
    expect(after.body.subscription).toMatchObject({ status: 'ACTIVE', blocked: false });
    expect(after.body.subscription.daysLeft).toBeGreaterThanOrEqual(59);
    expect(after.body.invoices[0]).toMatchObject({ status: 'PAID', periods: 2, total: plan.price * 2 });
    await ctx.http().get('/api/labs/me').set(auth(lab.token)).expect(200);
    await ctx.http().get(`/api/labs/${lab.providerId}/catalog`).expect(200);
    // Subscription money is platform revenue (no commission split) in the finance dashboard.
    const dash = await ctx.http().get('/api/finance/dashboard').set(auth(admin)).expect(200);
    expect(dash.body.totals.subscriptions).toBeGreaterThanOrEqual(plan.price * 2);
  });

  it('manual transfer: receipt → review → approval extends the period; a 100% coupon activates immediately', async () => {
    const lab = await createLab(ctx);
    const { body: s } = await ctx.http().get('/api/subscriptions/me').set(auth(lab.token)).expect(200);
    const plan = s.plans[0];
    await ctx.http().post('/api/subscriptions/me/subscribe').set(auth(lab.token)).send({ planId: plan.id, method: 'INSTAPAY' }).expect(400); // receipt required
    const file = (await ctx.http().post('/api/files').set(auth(lab.token)).field('purpose', 'PAYMENT_PROOF').attach('file', PNG, 'r.png').expect(201)).body;
    const inv = (await ctx.http().post('/api/subscriptions/me/subscribe').set(auth(lab.token)).send({ planId: plan.id, method: 'INSTAPAY', proofFileId: file.id, transferReference: 'IP-1' }).expect(201)).body;
    expect(inv.status).toBe('AWAITING_REVIEW');
    expect((await ctx.http().post('/api/subscriptions/me/subscribe').set(auth(lab.token)).send({ planId: plan.id, method: 'INSTAPAY', proofFileId: file.id }).expect(409)).body.error).toBe('INVOICE_UNDER_REVIEW');
    await ctx.http().get(`/api/files/${file.id}`).set(auth(admin)).expect(200); // finance can open the receipt
    const before = (await ctx.http().get('/api/subscriptions/me').set(auth(lab.token))).body.subscription.endsAt;
    await ctx.http().post(`/api/admin/subscriptions/invoices/${inv.invoiceId}/approve`).set(auth(admin)).send({}).expect(201);
    const s2 = (await ctx.http().get('/api/subscriptions/me').set(auth(lab.token))).body;
    expect(s2.subscription.status).toBe('ACTIVE');
    // Early renewal stacks on the remaining trial instead of wasting it.
    expect(new Date(s2.subscription.endsAt).getTime() - new Date(before).getTime()).toBeGreaterThan(29 * 86_400_000);
    await ctx.http().post(`/api/admin/subscriptions/invoices/${inv.invoiceId}/approve`).set(auth(admin)).send({}).expect(400);
    // Free month with a 100% subscription coupon.
    await ctx.http().post('/api/finance/coupons').set(auth(admin)).send({ code: 'FREEMONTH', type: 'PERCENTAGE', value: 100, serviceType: 'SUBSCRIPTION', perUserLimit: 1 }).expect(201);
    const free = (await ctx.http().post('/api/subscriptions/me/subscribe').set(auth(lab.token)).send({ planId: plan.id, method: 'ONLINE', couponCode: 'freemonth' }).expect(201)).body;
    expect(free.status).toBe('ACTIVATED');
    expect((await ctx.http().post('/api/subscriptions/me/subscribe').set(auth(lab.token)).send({ planId: plan.id, method: 'ONLINE', couponCode: 'FREEMONTH' }).expect(400)).body.error).toBe('COUPON_USER_LIMIT');
    // A patient coupon cannot pay a subscription.
    expect((await ctx.http().post('/api/subscriptions/me/subscribe').set(auth(lab.token)).send({ planId: plan.id, method: 'ONLINE', couponCode: 'WELCOME20' }).expect(400)).body.error).toBe('COUPON_NOT_APPLICABLE');
  });

  it('appointment: coupon at booking, online payment, commission split, automatic refund and coupon release on cancel', async () => {
    const doc = await createApprovedDoctor(ctx, { cancellationWindowHours: 0 });
    const p = await registerPatient(ctx);
    const future = (await availableSlots(ctx, doc.doctorId, 4)).filter((s) => new Date(s.startAt).getTime() > Date.now() + 3 * 3600_000);
    const slot = future[0];
    const day = (x: { startAt: string }) => new Date(x.startAt).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    const slot2 = future.find((x) => day(x) !== day(slot))!;
    const a = (await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slot.startAt, couponCode: 'welcome20' }).expect(201)).body;
    expect(a).toMatchObject({ price: 500, discount: 100, finalPrice: 400 });
    // WELCOME20 is once per patient.
    expect((await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slot2.startAt, couponCode: 'WELCOME20' }).expect(400)).body.error).toBe('COUPON_USER_LIMIT');
    // Someone else cannot pay (or even see) it.
    const other = await registerPatient(ctx);
    await ctx.http().post('/api/payments/checkout').set(auth(other.token)).send({ entityType: 'APPOINTMENT', entityId: a.id }).expect(404);
    const co = (await ctx.http().post('/api/payments/checkout').set(auth(p.token)).send({ entityType: 'APPOINTMENT', entityId: a.id }).expect(201)).body;
    expect(co.amount).toBe(400);
    expect((await paySandbox(ctx, co.redirectUrl).expect(201)).body.status).toBe('PAID');
    const paid = (await ctx.http().get(`/api/appointments/${a.id}`).set(auth(p.token)).expect(200)).body;
    expect(paid).toMatchObject({ paymentStatus: 'PAID', paymentMethod: 'ONLINE' });
    expect((await ctx.http().post('/api/payments/checkout').set(auth(p.token)).send({ entityType: 'APPOINTMENT', entityId: a.id }).expect(409)).body.error).toBe('ALREADY_PAID');
    // Ledger: 10% global commission, money held by the platform.
    const prov = (await ctx.http().get('/api/payments/provider').set(auth(doc.token)).expect(200)).body.items[0];
    expect(prov).toMatchObject({ amount: 400, commission: 40, providerAmount: 360, collectedBy: 'PLATFORM' });
    const st = (await ctx.http().get('/api/finance/statement').set(auth(doc.token)).expect(200)).body;
    expect(st.balance.balance).toBe(360);
    // Patients never see the commission split.
    const mine = (await ctx.http().get('/api/payments/mine').set(auth(p.token)).expect(200)).body.items[0];
    expect(mine.commission).toBeUndefined();
    // Cancel → refunded in full automatically, coupon given back.
    const [{ used_count: usedBefore }] = await ctx.ds.query(`SELECT used_count FROM coupons WHERE code = 'WELCOME20'`);
    await ctx.http().patch(`/api/appointments/${a.id}/cancel`).set(auth(p.token)).send({ reason: 'ظرف طارئ' }).expect(200);
    const pay = (await ctx.http().get(`/api/payments/${prov.id}`).set(auth(p.token)).expect(200)).body;
    expect(pay).toMatchObject({ status: 'REFUNDED', refundedAmount: 400 });
    const [{ used_count: usedAfter }] = await ctx.ds.query(`SELECT used_count FROM coupons WHERE code = 'WELCOME20'`);
    expect(usedAfter).toBe(usedBefore - 1);
    expect((await ctx.http().get('/api/finance/statement').set(auth(doc.token))).body.balance.balance).toBe(0);
    await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slot2.startAt, couponCode: 'WELCOME20' }).expect(201);
  });

  it('limited coupon under concurrency: 4 patients race for the last use — exactly one gets it', async () => {
    await ctx.http().post('/api/finance/coupons').set(auth(admin)).send({ code: 'LASTONE', type: 'FIXED', value: 50, usageLimit: 1 }).expect(201);
    const doc = await createApprovedDoctor(ctx);
    const slots = (await availableSlots(ctx, doc.doctorId, 3)).slice(0, 4);
    const patients = await Promise.all(slots.map(() => registerPatient(ctx)));
    const res = await Promise.all(patients.map((p, i) => ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slots[i].startAt, couponCode: 'LASTONE' })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    res.filter((r) => r.status !== 201).forEach((r) => expect(r.body.error).toBe('COUPON_USED_UP'));
    const [{ used_count }] = await ctx.ds.query(`SELECT used_count FROM coupons WHERE code = 'LASTONE'`);
    expect(used_count).toBe(1);
  });

  it('desk payments enter the ledger once; most specific commission rule wins; partial refunds reverse commission; only finance refunds', async () => {
    const doc = await createApprovedDoctor(ctx, { autoConfirm: true });
    await ctx.http().post('/api/finance/commission-rules').set(auth(admin)).send({ scope: 'PROVIDER', providerId: doc.providerId, type: 'FIXED', value: 30 }).expect(201);
    const p = await registerPatient(ctx);
    const [slot] = await availableSlots(ctx, doc.doctorId, 3);
    const a = (await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slot.startAt }).expect(201)).body;
    for (const status of ['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED']) {
      await ctx.http().patch(`/api/appointments/${a.id}/status`).set(auth(doc.token)).send({ status }).expect(200);
    }
    const rows = await ctx.ds.query(`SELECT p.id, p.amount::float AS amount, p.collected_by, c.commission_amount::float AS c FROM payments p JOIN commissions c ON c.payment_id = p.id WHERE p.entity_id = $1`, [a.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 500, collected_by: 'PROVIDER', c: 30 });
    // Cash collected by the doctor → the doctor owes the platform its commission.
    expect((await ctx.http().get('/api/finance/statement').set(auth(doc.token))).body.balance.balance).toBe(-30);
    await ctx.http().post(`/api/payments/${rows[0].id}/refund`).set(auth(doc.token)).send({ amount: 100, reason: 'تعويض' }).expect(403);
    await ctx.http().post(`/api/payments/${rows[0].id}/refund`).set(auth(admin)).send({ amount: 600, reason: 'أكثر من المدفوع' }).expect(400);
    const r = (await ctx.http().post(`/api/payments/${rows[0].id}/refund`).set(auth(admin)).send({ amount: 100, reason: 'تعويض جزئي' }).expect(201)).body;
    expect(r).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedAmount: 100 });
    expect(r.commission).toMatchObject({ reversed_commission: 6, reversed_provider: 94 });
    // Settlement brings the balance to zero.
    await ctx.http().post('/api/finance/settlements').set(auth(admin)).send({ providerId: doc.providerId, direction: 'TO_PLATFORM', amount: 24, reference: 'CASH-1' }).expect(201);
    expect((await ctx.http().get('/api/finance/statement').set(auth(doc.token))).body.balance.balance).toBe(0);
    // Receipt PDF for the patient; the doctor's patients cannot read other payments.
    const rc = await ctx.http().get(`/api/payments/${rows[0].id}/receipt.pdf`).set(auth(p.token)).expect(200);
    expect(rc.headers['content-type']).toContain('application/pdf');
    const stranger = await registerPatient(ctx);
    await ctx.http().get(`/api/payments/${rows[0].id}`).set(auth(stranger.token)).expect(404);
  });

  it('finance & subscription admin lists answer with and without filters', async () => {
    for (const url of [
      '/api/admin/subscriptions',
      '/api/admin/subscriptions?status=EXPIRED',
      '/api/admin/subscriptions?type=LABORATORY&expiringDays=30&search=%D9%85',
      '/api/admin/subscriptions/invoices?status=AWAITING_REVIEW',
      '/api/admin/subscriptions/plans',
      '/api/finance/dashboard',
      '/api/finance/balances?nonZero=true',
      '/api/finance/settlements',
      '/api/finance/commission-rules',
      '/api/finance/coupons?search=a',
      '/api/payments/admin?status=PAID&collectedBy=PLATFORM',
    ]) {
      const res = await ctx.http().get(url).set(auth(admin));
      expect([url, res.status]).toEqual([url, 200]);
    }
  });
});
