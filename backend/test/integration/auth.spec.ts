import { auth, Ctx, createContext, registerPatient, adminToken } from './helpers';

describe('Auth & permissions (integration)', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await createContext();
  });
  afterAll(async () => {
    await ctx?.app.close();
  });

  it('registers a patient, returns access token + httpOnly refresh cookie', async () => {
    const res = await ctx.http().post('/api/auth/register').send({ fullName: 'سارة', phone: '01055550001', password: 'Passw0rd!' }).expect(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeUndefined();
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toMatch(/medix_rt=.*HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(res.body.user.roles).toEqual(['PATIENT']);
    expect(res.body.user.phone).toBe('+201055550001');
  });

  it('never accepts role escalation through registration payloads', async () => {
    const res = await ctx.http().post('/api/auth/register').send({ fullName: 'x', phone: '01055550002', password: 'Passw0rd!', roles: ['SUPER_ADMIN'] });
    expect(res.status).toBe(400);
  });

  it('logs in by phone or email with a generic error on failure', async () => {
    await ctx.http().post('/api/auth/login').send({ identifier: '01055550001', password: 'Passw0rd!' }).expect(200);
    const bad = await ctx.http().post('/api/auth/login').send({ identifier: '01055550001', password: 'wrong-pass1' }).expect(401);
    const unknown = await ctx.http().post('/api/auth/login').send({ identifier: '01099990000', password: 'wrong-pass1' }).expect(401);
    expect(bad.body.message).toBe(unknown.body.message);
    expect(bad.body.stack).toBeUndefined();
  });

  it('rotates refresh tokens and revokes the whole family on reuse', async () => {
    const login = await ctx.http().post('/api/auth/login').send({ identifier: '01055550001', password: 'Passw0rd!', }).expect(200);
    const firstCookie = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const r1 = await ctx.http().post('/api/auth/refresh').set('Cookie', firstCookie).send({}).expect(200);
    const secondCookie = (r1.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    expect(secondCookie).not.toBe(firstCookie);
    // replay the first (already rotated) token → theft detected
    await ctx.http().post('/api/auth/refresh').set('Cookie', firstCookie).send({}).expect(401);
    // ...and the legitimately rotated token is now dead too
    await ctx.http().post('/api/auth/refresh').set('Cookie', secondCookie).send({}).expect(401);
  });

  it('logout-all invalidates existing access tokens immediately', async () => {
    const p = await registerPatient(ctx);
    await ctx.http().get('/api/auth/me').set(auth(p.token)).expect(200);
    await ctx.http().post('/api/auth/logout-all').set(auth(p.token)).expect(200);
    await ctx.http().get('/api/auth/me').set(auth(p.token)).expect(401);
  });

  it('password reset works once and kills old sessions', async () => {
    const p = await registerPatient(ctx);
    const f = await ctx.http().post('/api/auth/forgot-password').send({ identifier: p.user.phone }).expect(200);
    expect(f.body.devToken).toBeDefined();
    await ctx.http().post('/api/auth/reset-password').send({ token: f.body.devToken, newPassword: 'NewPassw0rd' }).expect(200);
    await ctx.http().post('/api/auth/reset-password').send({ token: f.body.devToken, newPassword: 'Another1x' }).expect(400);
    await ctx.http().get('/api/auth/me').set(auth(p.token)).expect(401);
    await ctx.http().post('/api/auth/login').send({ identifier: p.user.phone, password: 'NewPassw0rd' }).expect(200);
  });

  it('forgot-password does not reveal whether an account exists', async () => {
    const a = await ctx.http().post('/api/auth/forgot-password').send({ identifier: '01011112222' }).expect(200);
    expect(a.body.message).toBeDefined();
    expect(a.body.devToken).toBeUndefined();
  });

  it('enforces RBAC on admin endpoints', async () => {
    const p = await registerPatient(ctx);
    await ctx.http().get('/api/dashboards/admin').expect(401);
    await ctx.http().get('/api/dashboards/admin').set(auth(p.token)).expect(403);
    await ctx.http().get('/api/users').set(auth(p.token)).expect(403);
    await ctx.http().get('/api/audit-logs').set(auth(p.token)).expect(403);
    const admin = await adminToken(ctx);
    await ctx.http().get('/api/dashboards/admin').set(auth(admin)).expect(200);
  });

  it('suspending a user cuts off access instantly', async () => {
    const p = await registerPatient(ctx);
    const admin = await adminToken(ctx);
    await ctx.http().patch(`/api/users/${p.user.id}/status`).set(auth(admin)).send({ status: 'SUSPENDED', reason: 'test' }).expect(200);
    await ctx.http().get('/api/auth/me').set(auth(p.token)).expect(401);
    await ctx.http().post('/api/auth/login').send({ identifier: p.user.phone, password: 'Passw0rd!' }).expect(403);
  });

  it('errors never leak internals', async () => {
    const { token } = await registerPatient(ctx);
    const res = await ctx.http().get('/api/appointments/not-a-uuid').set(auth(token));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|QueryFailed|SELECT|at \w+ \(/);
    expect(res.body.requestId).toBeDefined();
  });
});
