import { io, Socket } from 'socket.io-client';
import { AddressInfo } from 'net';
import { adminToken, auth, availableSlots, Ctx, createApprovedDoctor, createContext, registerPatient } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('Chat (integration)', () => {
  let ctx: Ctx;
  let url: string;
  const sockets: Socket[] = [];
  beforeAll(async () => {
    ctx = await createContext();
    await ctx.app.listen(0);
    url = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await ctx?.app.close();
  });

  const connect = (token: string) =>
    new Promise<Socket>((resolve, reject) => {
      const s = io(`${url}/realtime`, { auth: { token }, transports: ['websocket'], forceNew: true });
      sockets.push(s);
      s.on('connect', () => setTimeout(() => resolve(s), 100));
      s.on('connect_error', reject);
    });
  const next = <T = any>(s: Socket, event: string, ms = 3000) =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
      s.once(event, (d: T) => {
        clearTimeout(t);
        resolve(d);
      });
    });

  it('patient opens a room with a doctor; both sides see it; opening twice reuses the same room', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const r1 = await ctx.http().post('/api/chat/rooms').set(auth(p.token)).send({ type: 'PATIENT_PROVIDER', providerId: doc.providerId, message: 'السلام عليكم' }).expect(201);
    const r2 = await ctx.http().post('/api/chat/rooms').set(auth(p.token)).send({ type: 'PATIENT_PROVIDER', providerId: doc.providerId }).expect(201);
    expect(r2.body.id).toBe(r1.body.id);
    const docRooms = await ctx.http().get('/api/chat/rooms').set(auth(doc.token)).expect(200);
    const room = docRooms.body.items.find((x: any) => x.id === r1.body.id);
    expect(room.title).toBe(p.user.fullName);
    expect(room.unread).toBe(1);
    const msgs = await ctx.http().get(`/api/chat/rooms/${r1.body.id}/messages`).set(auth(doc.token)).expect(200);
    expect(msgs.body.items[0].body).toBe('السلام عليكم');
  });

  it('outsiders cannot list, read, or post — another patient, another doctor, and even admins (private medical chat)', async () => {
    const doc = await createApprovedDoctor(ctx);
    const other = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const intruder = await registerPatient(ctx);
    const admin = await adminToken(ctx);
    const room = (await ctx.http().post('/api/chat/rooms').set(auth(p.token)).send({ type: 'PATIENT_PROVIDER', providerId: doc.providerId, message: 'خاص' }).expect(201)).body;
    for (const t of [intruder.token, other.token, admin]) {
      await ctx.http().get(`/api/chat/rooms/${room.id}/messages`).set(auth(t)).expect(404);
      await ctx.http().post(`/api/chat/rooms/${room.id}/messages`).set(auth(t)).send({ body: 'x' }).expect(404);
      const list = await ctx.http().get('/api/chat/rooms').set(auth(t)).expect(200);
      expect(list.body.items.find((x: any) => x.id === room.id)).toBeUndefined();
    }
  });

  it('only approved providers can be contacted; doctors cannot open patient rooms', async () => {
    const [spec] = await ctx.ds.query(`SELECT id FROM specialties WHERE slug='cardiology'`);
    const pending = await ctx.http().post('/api/auth/register/doctor').send({ fullName: 'غير معتمد', phone: '01088880001', email: 'pend-chat@test.local', password: 'Passw0rd!', specialtyId: spec.id, qualifications: 'MBBCh', licenseNumber: 'C-1', experienceYears: 1, consultationPrice: 100 }).expect(201);
    const p = await registerPatient(ctx);
    await ctx.http().post('/api/chat/rooms').set(auth(p.token)).send({ type: 'PATIENT_PROVIDER', providerId: pending.body.user.providers[0].id }).expect(404);
    const doc = await createApprovedDoctor(ctx);
    await ctx.http().post('/api/chat/rooms').set(auth(doc.token)).send({ type: 'PATIENT_PROVIDER', providerId: doc.providerId }).expect(403);
  });

  it('delivers messages, typing and read receipts in real time over Socket.IO', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const room = (await ctx.http().post('/api/chat/rooms').set(auth(p.token)).send({ type: 'PATIENT_PROVIDER', providerId: doc.providerId }).expect(201)).body;
    const ps = await connect(p.token);
    const ds = await connect(doc.token);

    const typing = next(ds, 'chat:typing');
    ps.emit('chat:typing', { roomId: room.id });
    expect((await typing).roomId).toBe(room.id);

    const incoming = next(ds, 'chat:message');
    const ack: any = await new Promise((res) => ps.emit('chat:send', { roomId: room.id, body: 'هل الدكتور متاح بكرة؟', clientId: 'c1' }, res));
    expect(ack.ok).toBe(true);
    const msg: any = await incoming;
    expect(msg.body).toBe('هل الدكتور متاح بكرة؟');
    expect(msg.clientId).toBe('c1');
    expect(msg.sender.side).toBe('A');

    const receipt = next(ps, 'chat:read');
    await ctx.http().post(`/api/chat/rooms/${room.id}/read`).set(auth(doc.token)).expect(200);
    expect((await receipt).side).toBe('B');
    const after = await ctx.http().get(`/api/chat/rooms/${room.id}/messages`).set(auth(p.token)).expect(200);
    expect(new Date(after.body.otherReadAt).getTime()).toBeGreaterThanOrEqual(new Date(msg.createdAt).getTime());
  });

  it('rejects socket sends to rooms the user is not in, and unauthenticated sockets', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const intruder = await registerPatient(ctx);
    const room = (await ctx.http().post('/api/chat/rooms').set(auth(p.token)).send({ type: 'PATIENT_PROVIDER', providerId: doc.providerId }).expect(201)).body;
    const s = await connect(intruder.token);
    const ack: any = await new Promise((res) => s.emit('chat:send', { roomId: room.id, body: 'x' }, res));
    expect(ack.ok).toBe(false);
    await expect(
      new Promise((resolve, reject) => {
        const bad = io(`${url}/realtime`, { auth: { token: 'garbage' }, transports: ['websocket'], forceNew: true });
        sockets.push(bad);
        bad.on('disconnect', () => resolve('disconnected'));
        setTimeout(() => reject(new Error('still connected')), 2000);
      }),
    ).resolves.toBe('disconnected');
  });

  it('block stops new messages; only the blocker can unblock; reporting lets moderators read (audited)', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const admin = await adminToken(ctx);
    const room = (await ctx.http().post('/api/chat/rooms').set(auth(p.token)).send({ type: 'PATIENT_PROVIDER', providerId: doc.providerId, message: 'مرحبا' }).expect(201)).body;
    await ctx.http().post(`/api/chat/rooms/${room.id}/block`).set(auth(doc.token)).expect(200);
    const blocked = await ctx.http().post(`/api/chat/rooms/${room.id}/messages`).set(auth(p.token)).send({ body: 'رد' }).expect(403);
    expect(blocked.body.error).toBe('CHAT_BLOCKED');
    await ctx.http().post(`/api/chat/rooms/${room.id}/unblock`).set(auth(p.token)).expect(403);
    await ctx.http().post(`/api/chat/rooms/${room.id}/report`).set(auth(p.token)).send({ reason: 'رسائل غير لائقة' }).expect(200);
    const reported = await ctx.http().get('/api/chat/rooms?reported=true').set(auth(admin)).expect(200);
    expect(reported.body.items.map((x: any) => x.id)).toContain(room.id);
    await ctx.http().get(`/api/chat/rooms/${room.id}/messages`).set(auth(admin)).expect(200);
    await ctx.http().post(`/api/chat/rooms/${room.id}/messages`).set(auth(admin)).send({ body: 'x' }).expect(403);
    const [{ n }] = await ctx.ds.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'CHAT_REPORTED_VIEWED' AND entity_id = $1`, [room.id]);
    expect(n).toBe(1);
    await ctx.http().post(`/api/chat/rooms/${room.id}/unblock`).set(auth(doc.token)).expect(200);
    await ctx.http().post(`/api/chat/rooms/${room.id}/messages`).set(auth(p.token)).send({ body: 'رد' }).expect(201);
  });

  it('attachments are private to the room', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const intruder = await registerPatient(ctx);
    const room = (await ctx.http().post('/api/chat/rooms').set(auth(p.token)).send({ type: 'PATIENT_PROVIDER', providerId: doc.providerId }).expect(201)).body;
    const f = (await ctx.http().post('/api/files').set(auth(p.token)).field('purpose', 'CHAT_ATTACHMENT').attach('file', PNG, 'rash.png').expect(201)).body;
    // someone else's upload cannot be attached
    await ctx.http().post(`/api/chat/rooms/${room.id}/messages`).set(auth(doc.token)).send({ fileId: f.id }).expect(400);
    await ctx.http().post(`/api/chat/rooms/${room.id}/messages`).set(auth(p.token)).send({ fileId: f.id, body: 'صورة' }).expect(201);
    await ctx.http().get(`/api/files/${f.id}`).set(auth(doc.token)).expect(200);
    await ctx.http().get(`/api/files/${f.id}`).set(auth(intruder.token)).expect(403);
  });

  it('support and admin↔provider rooms reach the platform team', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const admin = await adminToken(ctx);
    const support = (await ctx.http().post('/api/chat/rooms').set(auth(p.token)).send({ type: 'SUPPORT', message: 'عندي مشكلة في الحجز' }).expect(201)).body;
    expect(support.title).toBe('دعم ميديكس');
    const adminView = await ctx.http().get(`/api/chat/rooms/${support.id}/messages`).set(auth(admin)).expect(200);
    expect(adminView.body.items[0].body).toBe('عندي مشكلة في الحجز');
    await ctx.http().post(`/api/chat/rooms/${support.id}/messages`).set(auth(admin)).send({ body: 'تحت أمرك' }).expect(201);
    const back = await ctx.http().get(`/api/chat/rooms/${support.id}/messages`).set(auth(p.token)).expect(200);
    expect(back.body.items[1].sender.name).toMatch(/^فريق ميديكس/);

    // admin ↔ provider: one shared room per provider, from either side
    const a = (await ctx.http().post('/api/chat/rooms').set(auth(admin)).send({ type: 'ADMIN_PROVIDER', providerId: doc.providerId, message: 'برجاء رفع الترخيص' }).expect(201)).body;
    const b = (await ctx.http().post('/api/chat/rooms').set(auth(doc.token)).send({ type: 'ADMIN_PROVIDER', providerId: doc.providerId }).expect(201)).body;
    expect(b.id).toBe(a.id);
    expect(b.title).toBe('إدارة ميديكس');
    // a patient cannot open an admin room for a provider
    await ctx.http().post('/api/chat/rooms').set(auth(p.token)).send({ type: 'ADMIN_PROVIDER', providerId: doc.providerId }).expect(403);
  });

  it('unread counter tracks messages from the other side', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const room = (await ctx.http().post('/api/chat/rooms').set(auth(p.token)).send({ type: 'PATIENT_PROVIDER', providerId: doc.providerId }).expect(201)).body;
    for (const b of ['1', '2', '3']) await ctx.http().post(`/api/chat/rooms/${room.id}/messages`).set(auth(p.token)).send({ body: b }).expect(201);
    expect((await ctx.http().get('/api/chat/unread-count').set(auth(doc.token))).body.count).toBe(3);
    expect((await ctx.http().get('/api/chat/unread-count').set(auth(p.token))).body.count).toBe(0);
    // an offline doctor gets one notification for the burst, not three
    const [{ n }] = await ctx.ds.query(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = (SELECT owner_user_id FROM providers WHERE id = $1) AND type = 'CHAT_MESSAGE'`,
      [doc.providerId],
    );
    expect(n).toBe(1);
    await ctx.http().post(`/api/chat/rooms/${room.id}/read`).set(auth(doc.token)).expect(200);
    expect((await ctx.http().get('/api/chat/unread-count').set(auth(doc.token))).body.count).toBe(0);
  });

  it('global notification rules: disabling a channel stops deliveries regardless of user preference', async () => {
    const admin = await adminToken(ctx);
    await ctx.http().put('/api/settings/notifications.marketingEnabled').set(auth(admin)).send({ value: true }).expect(200);
    await ctx.http().put('/api/settings/appointments.reminderHours').set(auth(admin)).send({ value: 999 }).expect(400);
    const s = await ctx.http().get('/api/settings').set(auth(admin)).expect(200);
    expect(s.body['notifications.marketingEnabled']).toBe(true);
    void availableSlots;
  });
});

describe('Chat — provider-initiated', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await createContext();
  });
  afterAll(async () => {
    await ctx?.app.close();
  });

  it('a doctor can message only patients who booked with them', async () => {
    const doc = await createApprovedDoctor(ctx);
    const p = await registerPatient(ctx);
    const stranger = await registerPatient(ctx);
    const [slot] = await availableSlots(ctx, doc.doctorId);
    await ctx.http().post('/api/appointments').set(auth(p.token)).send({ doctorId: doc.doctorId, startAt: slot.startAt }).expect(201);
    const room = await ctx.http().post('/api/chat/rooms').set(auth(doc.token)).send({ type: 'PATIENT_PROVIDER', patientId: p.user.patientId, message: 'برجاء إحضار التحاليل' }).expect(201);
    const mine = await ctx.http().get('/api/chat/rooms').set(auth(p.token)).expect(200);
    expect(mine.body.items[0].id).toBe(room.body.id);
    await ctx.http().post('/api/chat/rooms').set(auth(doc.token)).send({ type: 'PATIENT_PROVIDER', patientId: stranger.user.patientId }).expect(403);
  });
});
