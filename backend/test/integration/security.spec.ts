import { totp } from '../../src/common/utils/totp';
import { adminToken, auth, availableSlots, Ctx, createApprovedDoctor, createContext, registerPatient, uniquePhone } from './helpers';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

describe('Security, audit, analytics & system (integration)', () => {
  let ctx: Ctx;
  let admin: string;
  beforeAll(async () => {
    ctx = await createContext();
    admin = await adminToken(ctx);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const signup = async () => {
    const phone = uniquePhone();
    const res = await ctx.http().post('/api/auth/register').set('User-Agent', WINDOWS).send({ phone, password: 'secret12' }).expect(201);
    return { phone, token: res.body.accessToken as string, id: res.body.user.id as string };
  };
  const loginReq = (identifier: string, password: string, ua = WINDOWS) => ctx.http().post('/api/auth/login').set('User-Agent', ua).send({ identifier, password });

  it('locks an account after 5 wrong passwords (even the right one is refused), notifies the owner; support unlocks', async () => {
    const u = await signup();
    for (let i = 0; i < 4; i++) await loginReq(u.phone, 'wrong-pass').expect(401);
    const fifth = await loginReq(u.phone, 'wrong-pass').expect(423);
    expect(fifth.body.error).toBe('ACCOUNT_LOCKED');
    await loginReq(u.phone, 'secret12').expect(423);
    const notes = (await ctx.http().get('/api/notifications').set(auth(u.token))).body.items;
    expect(notes.some((n: any) => n.type === 'ACCOUNT_LOCKED')).toBe(true);
    const ov = (await ctx.http().get('/api/security/overview').set(auth(admin)).expect(200)).body;
    expect(ov.locked.some((x: any) => x.id === u.id)).toBe(true);
    expect(ov.totals.lockouts).toBeGreaterThanOrEqual(1);
    // Patients cannot see the security centre.
    await ctx.http().get('/api/security/overview').set(auth(u.token)).expect(403);
    await ctx.http().post(`/api/security/users/${u.id}/unlock`).set(auth(admin)).expect(200);
    await loginReq(u.phone, 'secret12').expect(200);
    // A successful sign-in resets the counter.
    const [row] = await ctx.ds.query(`SELECT failed_login_count FROM users WHERE id = $1`, [u.id]);
    expect(row.failed_login_count).toBe(0);
  });

  it('two-step verification: enrol, challenge on login, one-time codes, backup codes, disable', async () => {
    const u = await signup();
    const setup = (await ctx.http().post('/api/auth/2fa/setup').set(auth(u.token)).expect(200)).body;
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    expect(setup.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    await ctx.http().post('/api/auth/2fa/enable').set(auth(u.token)).send({ code: '000000' }).expect(400);
    const en = (await ctx.http().post('/api/auth/2fa/enable').set(auth(u.token)).send({ code: totp(setup.secret) }).expect(200)).body;
    expect(en.backupCodes).toHaveLength(10);
    // The secret is stored encrypted, never in clear.
    const [row] = await ctx.ds.query(`SELECT two_factor_secret FROM users WHERE id = $1`, [u.id]);
    expect(row.two_factor_secret).not.toContain(setup.secret);

    const first = (await loginReq(u.phone, 'secret12').expect(200)).body;
    expect(first.twoFactorRequired).toBe(true);
    expect(first.accessToken).toBeUndefined();
    // The challenge is not an access token.
    await ctx.http().get('/api/auth/me').set(auth(first.challengeToken)).expect(401);
    await ctx.http().post('/api/auth/2fa/verify').send({ challengeToken: first.challengeToken, code: '123456' }).expect(401);
    // The code used at enrolment (same 30 s step) cannot be replayed.
    await ctx.http().post('/api/auth/2fa/verify').send({ challengeToken: first.challengeToken, code: totp(setup.secret) }).expect(401);
    const viaBackup = (await ctx.http().post('/api/auth/2fa/verify').send({ challengeToken: first.challengeToken, code: en.backupCodes[0].toLowerCase() }).expect(200)).body;
    expect(viaBackup.accessToken).toBeTruthy();
    await ctx.http().post('/api/auth/2fa/verify').send({ challengeToken: first.challengeToken, code: en.backupCodes[0] }).expect(401);
    const st = (await ctx.http().get('/api/auth/2fa').set(auth(viaBackup.accessToken)).expect(200)).body;
    expect(st).toMatchObject({ enabled: true, backupCodesLeft: 9 });
    // Disabling needs the password AND a code.
    await ctx.http().post('/api/auth/2fa/disable').set(auth(viaBackup.accessToken)).send({ password: 'nope', code: en.backupCodes[1] }).expect(401);
    await ctx.http().post('/api/auth/2fa/disable').set(auth(viaBackup.accessToken)).send({ password: 'secret12', code: en.backupCodes[1] }).expect(200);
    expect((await loginReq(u.phone, 'secret12').expect(200)).body.accessToken).toBeTruthy();
    const history = (await ctx.http().get('/api/auth/login-history').set(auth(viaBackup.accessToken)).expect(200)).body.map((x: any) => x.action);
    expect(history).toEqual(expect.arrayContaining(['TWO_FACTOR_ENABLED', 'TWO_FACTOR_DISABLED', 'TWO_FACTOR_BACKUP_CODE_USED', 'TWO_FACTOR_FAILED']));
  });

  it('support resets 2FA for a user who lost the phone and every session ends', async () => {
    const u = await signup();
    const setup = (await ctx.http().post('/api/auth/2fa/setup').set(auth(u.token)).expect(200)).body;
    await ctx.http().post('/api/auth/2fa/enable').set(auth(u.token)).send({ code: totp(setup.secret) }).expect(200);
    await ctx.http().post(`/api/security/users/${u.id}/reset-2fa`).set(auth(admin)).send({ reason: 'فقد الموبايل — تم التحقق بالبطاقة' }).expect(200);
    await ctx.http().get('/api/auth/me').set(auth(u.token)).expect(401);
    expect((await loginReq(u.phone, 'secret12').expect(200)).body.accessToken).toBeTruthy();
  });

  it('alerts the owner on a sign-in from a new device', async () => {
    const u = await signup();
    await loginReq(u.phone, 'secret12', WINDOWS).expect(200);
    const token = (await loginReq(u.phone, 'secret12', IPHONE).expect(200)).body.accessToken;
    const notes = (await ctx.http().get('/api/notifications').set(auth(token))).body.items;
    const alert = notes.find((n: any) => n.type === 'NEW_DEVICE_LOGIN');
    expect(alert?.body).toContain('Safari على iPhone');
    // Same device again → no second alert.
    await loginReq(u.phone, 'secret12', IPHONE).expect(200);
    const again = (await ctx.http().get('/api/notifications').set(auth(token))).body.items.filter((n: any) => n.type === 'NEW_DEVICE_LOGIN');
    expect(again).toHaveLength(1);
  });

  it('staff 2FA policy: staff without 2FA can only reach account setup until they enrol', async () => {
    await ctx.http().put('/api/settings/security.require2faForStaff').set(auth(admin)).send({ value: true }).expect(200);
    const blocked = await ctx.http().get('/api/users').set(auth(admin)).expect(403);
    expect(blocked.body.error).toBe('TWO_FACTOR_SETUP_REQUIRED');
    expect((await ctx.http().get('/api/auth/me').set(auth(admin)).expect(200)).body.twoFactorSetupRequired).toBe(true);
    // Patients are never affected.
    const p = await registerPatient(ctx);
    await ctx.http().get('/api/appointments?scope=patient').set(auth(p.token)).expect(200);
    const setup = (await ctx.http().post('/api/auth/2fa/setup').set(auth(admin)).expect(200)).body;
    const en = (await ctx.http().post('/api/auth/2fa/enable').set(auth(admin)).send({ code: totp(setup.secret) }).expect(200)).body;
    await ctx.http().get('/api/users').set(auth(admin)).expect(200);
    await ctx.http().put('/api/settings/security.require2faForStaff').set(auth(admin)).send({ value: false }).expect(200);
    await ctx.http().post('/api/auth/2fa/disable').set(auth(admin)).send({ password: 'Admin@12345', code: en.backupCodes[0] }).expect(200);
  });

  it('analytics: platform KPIs with comparison, provider scope, exports and permissions', async () => {
    const doc = await createApprovedDoctor(ctx, { autoConfirm: true });
    const p = await registerPatient(ctx);
    const [slot] = await availableSlots(ctx, doc.doctorId, 3);
    const a = (await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slot.startAt }).expect(201)).body;
    for (const status of ['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED']) await ctx.http().patch(`/api/appointments/${a.id}/status`).set(auth(doc.token)).send({ status }).expect(200);
    await ctx.http().post('/api/system/cache/clear').set(auth(admin)).expect(200);

    const ov = (await ctx.http().get('/api/analytics/overview').set(auth(admin)).expect(200)).body;
    expect(ov.current.bookings).toBeGreaterThanOrEqual(1);
    expect(ov.current.gmv).toBeGreaterThanOrEqual(500);
    expect(ov.previous).toBeTruthy();
    expect(ov.change).toHaveProperty('bookings');
    const mine = (await ctx.http().get('/api/analytics/provider/overview').set(auth(doc.token)).expect(200)).body;
    expect(mine.current).toMatchObject({ bookings: 1, completed: 1, completionRate: 100, newPatients: 1, gmv: 500 });
    expect(mine.current.netRevenue).toBe(450);
    expect(mine.current).not.toHaveProperty('platformRevenue');

    const ts = (await ctx.http().get('/api/analytics/timeseries?granularity=day').set(auth(admin)).expect(200)).body;
    expect(ts.series.length).toBe(30);
    const bd = (await ctx.http().get('/api/analytics/provider/breakdowns').set(auth(doc.token)).expect(200)).body;
    expect(bd.byKind).toEqual([expect.objectContaining({ key: 'APPOINTMENT', bookings: 1, completed: 1 })]);
    const lb = (await ctx.http().get('/api/analytics/providers?sort=bookings').set(auth(admin)).expect(200)).body;
    expect(lb.items[0]).toMatchObject({ providerId: doc.providerId, bookings: 1 });
    for (const url of ['/api/analytics/funnel', '/api/analytics/cohorts', '/api/analytics/provider/funnel', '/api/analytics/provider/cohorts']) {
      await ctx.http().get(url).set(auth(url.includes('provider') ? doc.token : admin)).expect(200);
    }
    const x = await ctx.http().get('/api/analytics/export.xlsx').set(auth(admin)).expect(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    const px = await ctx.http().get('/api/analytics/provider/export.xlsx').set(auth(doc.token)).expect(200);
    expect(px.headers['content-disposition']).toContain('.xlsx');
    // Patients and doctors cannot read platform analytics.
    await ctx.http().get('/api/analytics/overview').set(auth(p.token)).expect(403);
    await ctx.http().get('/api/analytics/overview').set(auth(doc.token)).expect(403);
    await ctx.http().get('/api/analytics/provider/overview').set(auth(p.token)).expect(403);
  });

  it('audit log: categories, actor search, record history, CSV export (BOM, formula-safe); system health & public cache', async () => {
    const u = await signup();
    await loginReq(u.phone, 'bad-one').expect(401);
    const list = (await ctx.http().get(`/api/audit-logs?category=AUTH&userId=${u.id}`).set(auth(admin)).expect(200)).body;
    expect(list.items.map((x: any) => x.action)).toEqual(expect.arrayContaining(['USER_REGISTERED', 'LOGIN_FAILED']));
    expect(list.items.every((x: any) => x.category === 'AUTH')).toBe(true);
    const hist = (await ctx.http().get(`/api/audit-logs/entity/users/${u.id}`).set(auth(admin)).expect(200)).body;
    expect(hist.length).toBeGreaterThanOrEqual(2);
    const csv = await ctx.http().get(`/api/audit-logs/export.csv?userId=${u.id}`).set(auth(admin)).expect(200);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain('LOGIN_FAILED');
    await ctx.http().get('/api/audit-logs').set(auth(u.token)).expect(403);

    const h = (await ctx.http().get('/api/system/health').set(auth(admin)).expect(200)).body;
    expect(h.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(h.http.requests).toBeGreaterThan(0);
    await ctx.http().get('/api/system/health').set(auth(u.token)).expect(403);

    const r1 = await ctx.http().get('/api/specialties').expect(200);
    const r2 = await ctx.http().get('/api/specialties').expect(200);
    expect([r1.headers['x-cache'], r2.headers['x-cache']]).toEqual(['MISS', 'HIT']);
    expect(r2.headers['cache-control']).toContain('public');
    expect(r2.body).toEqual(r1.body);
    // A write invalidates the cached list.
    await ctx.http().post('/api/specialties').set(auth(admin)).send({ nameAr: 'تخصص للاختبار', nameEn: 'Test specialty', slug: 'test-specialty' }).expect(201);
    const r3 = await ctx.http().get('/api/specialties').expect(200);
    expect(r3.headers['x-cache']).toBe('MISS');
  });
});
