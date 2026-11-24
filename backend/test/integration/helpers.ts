import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://medix:medix@localhost:5432/medix_test';
process.env.JWT_SECRET = 'test_access_secret_0123456789abcdef0123456789';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_0123456789abcdef0123456789';
process.env.UPLOAD_LOCAL_DIR = '/tmp/medix-test-storage';
process.env.FRONTEND_URL = 'http://localhost:5173';

// Imported after env is set.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require('../../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { configureApp } = require('../../src/bootstrap');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataSourceOptions } = require('../../src/database/data-source');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const seed = require('../../src/database/seeds/seed');

export interface Ctx {
  app: INestApplication;
  ds: DataSource;
  http: () => request.SuperTest<request.Test>;
}

let counter = Math.floor(Math.random() * 1_000_000);
export const uniquePhone = () => `010${String(10_000_000 + (counter++ % 89_999_999)).padStart(8, '0')}`;

/** Fresh schema via real migrations (not synchronize) + RBAC/reference seed, then boot the real app. */
export async function createContext(): Promise<Ctx> {
  const admin = new DataSource(dataSourceOptions(process.env.DATABASE_URL));
  await admin.initialize();
  await admin.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await admin.runMigrations({ transaction: 'each' });
  await admin.transaction(async (m) => {
    await seed.seedRbac(m);
    await seed.seedSuperAdmin(m);
    await seed.seedReference(m);
  });
  await admin.destroy();

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ logger: ['error'] });
  configureApp(app, { swagger: false });
  await app.init();
  const ds = app.get(DataSource);
  return { app, ds, http: () => request(app.getHttpServer()) as any };
}

export async function registerPatient(ctx: Ctx, name = 'مريض تجريبي') {
  const res = await ctx
    .http()
    .post('/api/auth/register')
    .send({ fullName: name, phone: uniquePhone(), password: 'Passw0rd!' })
    .expect(201);
  return { token: res.body.accessToken as string, user: res.body.user, cookie: res.headers['set-cookie'] as unknown as string[] };
}

export async function login(ctx: Ctx, identifier: string, password: string) {
  const res = await ctx.http().post('/api/auth/login').send({ identifier, password }).expect(200);
  return res.body.accessToken as string;
}

export const adminToken = (ctx: Ctx) => login(ctx, 'admin@medix.local', 'Admin@12345');

/**
 * Registers a doctor, approves them as admin, and gives them an all-week schedule
 * (00:00–24:00, 30-minute slots) so tests can book at any time of day.
 */
export async function createApprovedDoctor(ctx: Ctx, opts: { name?: string; autoConfirm?: boolean; cancellationWindowHours?: number } = {}) {
  const [spec] = await ctx.ds.query(`SELECT id FROM specialties WHERE slug = 'cardiology'`);
  const email = `doc${counter++}@test.local`;
  const res = await ctx
    .http()
    .post('/api/auth/register/doctor')
    .send({
      fullName: opts.name ?? 'طبيب تجريبي',
      phone: uniquePhone(),
      email,
      password: 'Passw0rd!',
      specialtyId: spec.id,
      qualifications: 'بكالوريوس الطب',
      licenseNumber: `LIC-${counter}`,
      experienceYears: 5,
      consultationPrice: 500,
      clinic: { name: 'عيادة', address: 'شارع التجربة 1' },
    })
    .expect(201);
  const token = res.body.accessToken as string;
  const providerId = res.body.user.providers[0].id as string;
  const doctorId = res.body.user.doctorId as string;
  const admin = await adminToken(ctx);
  await ctx.http().patch(`/api/admin/providers/${providerId}/status`).set('Authorization', `Bearer ${admin}`).send({ action: 'APPROVE' }).expect(200);
  const [branch] = await ctx.ds.query(`SELECT id FROM provider_branches WHERE provider_id = $1`, [providerId]);
  await ctx
    .http()
    .put('/api/doctors/me/schedule')
    .set('Authorization', `Bearer ${token}`)
    .send({ blocks: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, start: '00:00', end: '24:00', slotDuration: 30, branchId: branch.id })) })
    .expect(200);
  if (opts.autoConfirm === false || opts.cancellationWindowHours !== undefined) {
    await ctx
      .http()
      .patch('/api/doctors/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...(opts.autoConfirm === false ? { autoConfirm: false } : {}),
        ...(opts.cancellationWindowHours !== undefined ? { cancellationWindowHours: opts.cancellationWindowHours } : {}),
      })
      .expect(200);
  }
  return { token, doctorId, providerId, branchId: branch.id as string, email };
}

/** Available slots for a doctor, flattened. */
export async function availableSlots(ctx: Ctx, doctorId: string, days = 3) {
  const res = await ctx.http().get(`/api/doctors/${doctorId}/availability?days=${days}`).expect(200);
  return (res.body.days as any[]).flatMap((d) => d.slots).filter((s: any) => s.available) as { startAt: string; endAt: string }[];
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
