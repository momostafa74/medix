import { SettingsService } from '../settings/settings.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomInt, randomUUID } from 'crypto';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  Doctor,
  DoctorSpecialty,
  Laboratory,
  MedicalRecord,
  Pharmacy,
  RadiologyCenter,
  Patient,
  Provider,
  ProviderBranch,
  ProviderType,
  Role,
  RoleCode,
  Session,
  Specialty,
  TokenPurpose,
  User,
  UserStatus,
  VerificationStatus,
  VerificationToken,
} from '../../database/entities';
import { secureToken, sha256, slugify } from '../../common/utils/codes';
import { normalizePhone } from '../../common/utils/phone';
import { describeDevice, deviceKey, lockMinutesLeft } from '../../common/utils/security';
import { TwoFactorService } from './two-factor.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailChannel, SmsChannel } from '../notifications/channels';
import { JobQueueService } from '../../common/jobs/job-queue.service';
import { AuthUserLoader } from './auth-user.loader';
import {
  ChangePasswordDto,
  LoginDto,
  RegisterDoctorDto,
  RegisterProviderDto,
  RegisterPatientDto,
  ResetPasswordDto,
} from './auth.dto';

export interface ClientMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const BCRYPT_ROUNDS = 12;
/** Audit actions a user sees in their own "login history". */
export const SECURITY_SELF_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGIN_BLOCKED_LOCKED',
  'ACCOUNT_LOCKED',
  'NEW_DEVICE_LOGIN',
  'TWO_FACTOR_ENABLED',
  'TWO_FACTOR_DISABLED',
  'TWO_FACTOR_FAILED',
  'TWO_FACTOR_BACKUP_CODE_USED',
  'TWO_FACTOR_RESET_BY_ADMIN',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'LOGOUT_ALL',
];
const INVALID_LOGIN = 'رقم الهاتف/البريد أو كلمة المرور غير صحيحة';
// Pre-computed hash used to equalise timing when the user does not exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private ds: DataSource,
    private jwt: JwtService,
    private config: ConfigService,
    private loader: AuthUserLoader,
    private audit: AuditService,
    private notifications: NotificationsService,
    private jobs: JobQueueService,
    private email: EmailChannel,
    private sms: SmsChannel,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Session) private sessions: Repository<Session>,
    @InjectRepository(VerificationToken) private vtokens: Repository<VerificationToken>,
    private settings: SettingsService,
    private twoFactor: TwoFactorService,
  ) {}

  /** Every new doctor / lab / radiology center / pharmacy starts with a free trial period. */
  private async startTrial(m: EntityManager, providerId: string) {
    const days = await this.settings.get<number>('subscriptions.trialDays');
    const end = new Date(Date.now() + days * 86_400_000);
    await m.query(`INSERT INTO provider_subscriptions (provider_id, status, trial_ends_at, current_period_end) VALUES ($1, 'TRIAL', $2, $2) ON CONFLICT (provider_id) DO NOTHING`, [providerId, end]);
    await m.query(`UPDATE providers SET subscription_ends_at = $2, subscription_active = true WHERE id = $1`, [providerId, end]);
  }

  // ─────────────── Registration ───────────────

  private async assertUnique(m: EntityManager, phone: string, email?: string | null) {
    if (await m.exists(User, { where: { phone } })) throw new ConflictException('رقم الهاتف مسجل من قبل');
    if (email && (await m.exists(User, { where: { email } }))) {
      throw new ConflictException('البريد الإلكتروني مسجل من قبل');
    }
  }

  private phoneOrThrow(raw: string) {
    const phone = normalizePhone(raw);
    if (!phone) throw new BadRequestException('رقم الهاتف غير صحيح');
    return phone;
  }

  async registerPatient(dto: RegisterPatientDto, meta: ClientMeta) {
    const phone = this.phoneOrThrow(dto.phone);
    const email = dto.email?.toLowerCase() || null;
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.ds.transaction(async (m) => {
      await this.assertUnique(m, phone, email);
      const role = await m.findOneByOrFail(Role, { code: RoleCode.PATIENT });
      const user = await m.save(
        m.create(User, {
          // Phone-only sign-up: a readable placeholder until the patient adds a name.
          fullName: dto.fullName?.trim() || `مريض ${phone.slice(-4)}`,
          profileCompleted: !!dto.fullName?.trim(),
          phone,
          email,
          passwordHash,
          status: UserStatus.ACTIVE,
          roles: [role],
        }),
      );
      const patient = await m.save(
        m.create(Patient, {
          userId: user.id,
          dateOfBirth: dto.dateOfBirth ?? null,
          gender: dto.gender ?? null,
          address: dto.address ?? null,
          cityId: dto.cityId ?? null,
          areaId: dto.areaId ?? null,
        }),
      );
      await m.save(m.create(MedicalRecord, { patientId: patient.id }));
      await this.audit.log(
        { userId: user.id, action: 'USER_REGISTERED', entity: 'users', entityId: user.id, newValue: { role: 'PATIENT' }, ...meta },
        m,
      );
      return user;
    });

    this.queueVerification(user.id);
    return this.loginUser(user.id, meta);
  }

  async registerDoctor(dto: RegisterDoctorDto, meta: ClientMeta) {
    const phone = this.phoneOrThrow(dto.phone);
    const email = dto.email.toLowerCase();
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const whatsapp = dto.whatsappNumber ? normalizePhone(dto.whatsappNumber) : phone;

    const user = await this.ds.transaction(async (m) => {
      await this.assertUnique(m, phone, email);
      const specialtyIds = [dto.specialtyId, ...(dto.subSpecialtyIds ?? [])].filter((v, i, a) => a.indexOf(v) === i);
      const specialties = await m.find(Specialty, { where: { id: In(specialtyIds), isActive: true } });
      if (specialties.length !== specialtyIds.length) throw new BadRequestException('التخصص المختار غير متاح');

      const role = await m.findOneByOrFail(Role, { code: RoleCode.DOCTOR });
      const user = await m.save(
        m.create(User, { fullName: dto.fullName, phone, email, passwordHash, status: UserStatus.ACTIVE, roles: [role] }),
      );
      const displayName = `${dto.title ?? 'د.'} ${dto.fullName}`.trim();
      const provider = await m.save(
        m.create(Provider, {
          type: ProviderType.DOCTOR,
          ownerUserId: user.id,
          nameAr: displayName,
          slug: slugify(dto.fullName),
          description: dto.bio ?? null,
          phone,
          whatsappNumber: whatsapp,
          email,
          verificationStatus: VerificationStatus.PENDING,
        }),
      );
      await this.startTrial(m, provider.id);
      const doctor = await m.save(
        m.create(Doctor, {
          userId: user.id,
          providerId: provider.id,
          title: dto.title ?? 'د.',
          gender: dto.gender ?? null,
          bio: dto.bio ?? null,
          qualifications: dto.qualifications,
          licenseNumber: dto.licenseNumber,
          licenseAuthority: dto.licenseAuthority ?? null,
          experienceYears: dto.experienceYears,
          consultationPrice: dto.consultationPrice,
        }),
      );
      await m.save(
        specialtyIds.map((sid) =>
          m.create(DoctorSpecialty, { doctorId: doctor.id, specialtyId: sid, isPrimary: sid === dto.specialtyId }),
        ),
      );
      if (dto.clinic) {
        await m.save(
          m.create(ProviderBranch, {
            providerId: provider.id,
            name: dto.clinic.name,
            address: dto.clinic.address,
            phone: dto.clinic.phone ? normalizePhone(dto.clinic.phone) : null,
            cityId: dto.clinic.cityId ?? null,
            areaId: dto.clinic.areaId ?? null,
          }),
        );
      }
      await this.audit.log(
        {
          userId: user.id,
          action: 'PROVIDER_REGISTERED',
          entity: 'providers',
          entityId: provider.id,
          newValue: { type: 'DOCTOR', licenseNumber: dto.licenseNumber },
          ...meta,
        },
        m,
      );
      return user;
    });

    // Tell admins there is a provider waiting for review.
    const admins: { id: string }[] = await this.ds.query(
      `SELECT DISTINCT ur.user_id AS id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.code IN ('SUPER_ADMIN','ADMIN')`,
    );
    await this.notifications.notifyMany(
      admins.map((a) => a.id),
      {
        type: 'PROVIDER_PENDING_APPROVAL',
        category: 'SYSTEM',
        title: 'طلب انضمام طبيب جديد',
        body: `قام ${dto.fullName} بالتسجيل كطبيب وينتظر المراجعة.`,
        data: { userId: user.id },
      },
    );
    this.queueVerification(user.id);
    return this.loginUser(user.id, meta);
  }

  async registerProvider(dto: RegisterProviderDto, meta: ClientMeta) {
    const phone = this.phoneOrThrow(dto.phone);
    const email = dto.email.toLowerCase();
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const whatsapp = dto.whatsappNumber ? normalizePhone(dto.whatsappNumber) : phone;
    if (dto.whatsappNumber && !whatsapp) throw new BadRequestException('رقم الواتساب غير صحيح');
    const KIND = {
      LABORATORY: { type: ProviderType.LABORATORY, role: RoleCode.LAB_ADMIN, label: 'معمل تحاليل' },
      RADIOLOGY: { type: ProviderType.RADIOLOGY, role: RoleCode.RADIOLOGY_ADMIN, label: 'مركز أشعة' },
      PHARMACY: { type: ProviderType.PHARMACY, role: RoleCode.PHARMACY_ADMIN, label: 'صيدلية' },
    }[dto.type];

    const user = await this.ds.transaction(async (m) => {
      await this.assertUnique(m, phone, email);
      const role = await m.findOneByOrFail(Role, { code: KIND.role });
      const user = await m.save(m.create(User, { fullName: dto.fullName, phone, email, passwordHash, status: UserStatus.ACTIVE, roles: [role] }));
      const provider = await m.save(
        m.create(Provider, {
          type: KIND.type,
          ownerUserId: user.id,
          nameAr: dto.nameAr,
          nameEn: dto.nameEn ?? null,
          slug: slugify(dto.nameEn || dto.nameAr),
          description: dto.description ?? null,
          phone,
          whatsappNumber: whatsapp,
          email,
          homeServiceAvailable: !!dto.homeService,
          verificationStatus: VerificationStatus.PENDING,
        }),
      );
      await this.startTrial(m, provider.id);
      await m.save(
        m.create(ProviderBranch, {
          providerId: provider.id,
          name: dto.branch.name,
          address: dto.branch.address,
          phone: dto.branch.phone ? normalizePhone(dto.branch.phone) : null,
          cityId: dto.branch.cityId ?? null,
          areaId: dto.branch.areaId ?? null,
        }),
      );
      if (KIND.type === ProviderType.LABORATORY) await m.save(m.create(Laboratory, { providerId: provider.id, homeCollection: !!dto.homeService }));
      if (KIND.type === ProviderType.RADIOLOGY) await m.save(m.create(RadiologyCenter, { providerId: provider.id }));
      if (KIND.type === ProviderType.PHARMACY) await m.save(m.create(Pharmacy, { providerId: provider.id, deliveryAvailable: !!dto.homeService }));
      await this.audit.log(
        { userId: user.id, action: 'PROVIDER_REGISTERED', entity: 'providers', entityId: provider.id, newValue: { type: KIND.type, licenseNumber: dto.licenseNumber ?? null }, ...meta },
        m,
      );
      return user;
    });

    const admins: { id: string }[] = await this.ds.query(
      `SELECT DISTINCT ur.user_id AS id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.code IN ('SUPER_ADMIN','ADMIN')`,
    );
    await this.notifications.notifyMany(
      admins.map((a) => a.id),
      {
        type: 'PROVIDER_PENDING_APPROVAL',
        category: 'SYSTEM',
        title: `طلب انضمام ${KIND.label} جديد`,
        body: `قام "${dto.nameAr}" بالتسجيل كـ${KIND.label} وينتظر المراجعة.`,
        data: { userId: user.id },
      },
    );
    this.queueVerification(user.id);
    return this.loginUser(user.id, meta);
  }

  // ─────────────── Login / tokens ───────────────

  async login(dto: LoginDto, meta: ClientMeta) {
    const identifier = dto.identifier.trim();
    const qb = this.users.createQueryBuilder('u').addSelect('u.passwordHash');
    const asPhone = normalizePhone(identifier);
    if (identifier.includes('@')) qb.where('lower(u.email) = :e', { e: identifier.toLowerCase() });
    else if (asPhone) qb.where('u.phone = :p', { p: asPhone });
    else {
      await bcrypt.compare(dto.password, DUMMY_HASH);
      throw new UnauthorizedException(INVALID_LOGIN);
    }
    const user = await qb.getOne();
    const ok = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    // A locked account is refused even with the right password (stops online guessing).
    const locked = lockMinutesLeft(user?.lockedUntil);
    if (user && locked) {
      await this.audit.log({ userId: user.id, action: 'LOGIN_BLOCKED_LOCKED', entity: 'users', entityId: user.id, ...meta });
      throw this.lockedError(locked);
    }
    if (!user || !ok) {
      await this.audit.log({ userId: user?.id ?? null, action: 'LOGIN_FAILED', entity: 'users', entityId: user?.id, newValue: { identifier }, ...meta });
      if (user) await this.registerFailure(user.id, meta);
      throw new UnauthorizedException(INVALID_LOGIN);
    }
    if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.INACTIVE) {
      throw new ForbiddenException({ message: 'تم إيقاف هذا الحساب، تواصل مع الدعم', code: 'ACCOUNT_DISABLED' });
    }
    if (user.failedLoginCount) await this.users.update(user.id, { failedLoginCount: 0 });
    if (user.twoFactorEnabled) {
      await this.audit.log({ userId: user.id, action: 'LOGIN_PASSWORD_OK_2FA_PENDING', entity: 'users', entityId: user.id, ...meta });
      return { twoFactorRequired: true as const, challengeToken: await this.twoFactor.challengeToken(user) };
    }
    return this.loginUser(user.id, meta);
  }

  private lockedError(minutes: number) {
    return new HttpException(
      { error: 'ACCOUNT_LOCKED', message: `تم قفل الحساب مؤقتاً بسبب محاولات دخول خاطئة متكررة. حاول مرة أخرى بعد ${minutes} دقيقة أو أعد تعيين كلمة المرور.` },
      423,
    );
  }

  /** Counts a wrong password / code atomically; locks the account when the limit is reached. */
  private async registerFailure(userId: string, meta: ClientMeta) {
    const max = await this.settings.get<number>('security.maxFailedLogins');
    const minutes = await this.settings.get<number>('security.lockMinutes');
    const [[row]] = await this.ds.query(
      `UPDATE users SET
         failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
         locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3::int) ELSE locked_until END
       WHERE id = $1 RETURNING failed_login_count, locked_until`,
      [userId, max, minutes],
    );
    if (row?.locked_until && lockMinutesLeft(row.locked_until)) {
      await this.audit.log({ userId, action: 'ACCOUNT_LOCKED', entity: 'users', entityId: userId, newValue: { minutes, after: max }, ...meta });
      await this.notifications.notify(userId, {
        type: 'ACCOUNT_LOCKED',
        category: 'SYSTEM',
        title: 'تم قفل حسابك مؤقتاً',
        body: `تمت ${max} محاولات دخول بكلمة مرور خاطئة${meta.ip ? ` من ${meta.ip}` : ''}، فقفلنا الحساب ${minutes} دقيقة. لو مش إنت، غيّر كلمة المرور.`,
        force: true,
      });
      throw this.lockedError(minutes);
    }
  }

  /** Second step of a 2FA login. Wrong codes count towards the same lockout as wrong passwords. */
  async completeTwoFactor(challengeToken: string, code: string, meta: ClientMeta) {
    const userId = await this.twoFactor.readChallenge(challengeToken);
    const user = await this.users.findOneByOrFail({ id: userId });
    const locked = lockMinutesLeft(user.lockedUntil);
    if (locked) throw this.lockedError(locked);
    if (user.status !== UserStatus.ACTIVE) throw new ForbiddenException({ message: 'تم إيقاف هذا الحساب، تواصل مع الدعم', code: 'ACCOUNT_DISABLED' });
    const used = await this.twoFactor.consume(userId, code);
    if (!used) {
      await this.audit.log({ userId, action: 'TWO_FACTOR_FAILED', entity: 'users', entityId: userId, ...meta });
      await this.registerFailure(userId, meta);
      throw new UnauthorizedException({ message: 'كود التحقق غير صحيح', code: 'INVALID_2FA_CODE' });
    }
    if (user.failedLoginCount) await this.users.update(userId, { failedLoginCount: 0 });
    if (used === 'BACKUP') {
      const left = await this.twoFactor.backupCodesLeft(userId);
      await this.audit.log({ userId, action: 'TWO_FACTOR_BACKUP_CODE_USED', entity: 'users', entityId: userId, newValue: { left }, ...meta });
      await this.notifications.notify(userId, { type: 'TWO_FACTOR_BACKUP_USED', category: 'SYSTEM', title: 'تم استخدام كود احتياطي', body: `دخلت بكود احتياطي — باقي ${left} أكواد. لو فقدت موبايلك أنشئ أكواداً جديدة من إعدادات الأمان.`, force: true });
    }
    return this.loginUser(userId, meta, used);
  }

  private async loginUser(userId: string, meta: ClientMeta, secondFactor?: 'TOTP' | 'BACKUP') {
    await this.alertIfNewDevice(userId, meta);
    await this.users.update(userId, { lastLoginAt: new Date() });
    const tokens = await this.issueTokens(userId, meta);
    await this.audit.log({ userId, action: 'LOGIN', entity: 'users', entityId: userId, newValue: secondFactor ? { secondFactor } : undefined, ...meta });
    return { ...tokens, user: await this.me(userId) };
  }

  /** Notifies the owner when an account signs in from a browser/OS it has not used in 180 days. */
  private async alertIfNewDevice(userId: string, meta: ClientMeta) {
    if (!meta.userAgent || !(await this.settings.get<boolean>('security.newDeviceAlerts'))) return;
    const rows: { user_agent: string | null }[] = await this.ds.query(
      `SELECT DISTINCT user_agent FROM sessions WHERE user_id = $1 AND created_at > now() - interval '180 days' LIMIT 100`,
      [userId],
    );
    if (!rows.length) return; // first sign-in ever — nothing to compare with
    const key = deviceKey(meta.userAgent);
    if (rows.some((r) => deviceKey(r.user_agent) === key)) return;
    await this.audit.log({ userId, action: 'NEW_DEVICE_LOGIN', entity: 'users', entityId: userId, newValue: { device: key }, ...meta });
    await this.notifications.notify(userId, {
      type: 'NEW_DEVICE_LOGIN',
      category: 'SYSTEM',
      title: 'تسجيل دخول من جهاز جديد',
      body: `تم الدخول لحسابك من ${key}${meta.ip ? ` (IP ${meta.ip})` : ''}. لو مش إنت، غيّر كلمة المرور وسجّل الخروج من كل الأجهزة من إعدادات الأمان.`,
      data: { security: true },
      force: true,
    });
  }

  private async signAccess(userId: string) {
    const user = await this.users.findOneByOrFail({ id: userId });
    return this.jwt.signAsync(
      { sub: userId, tv: user.tokenVersion },
      { secret: this.config.get('jwt.accessSecret'), expiresIn: this.config.get('jwt.accessTtl'), algorithm: 'HS256' },
    );
  }

  /** Opaque random refresh token; only its SHA-256 is stored. */
  private async issueTokens(userId: string, meta: ClientMeta, familyId: string = randomUUID(), m?: EntityManager): Promise<TokenPair> {
    const refreshToken = secureToken(48);
    const refreshExpiresAt = new Date(Date.now() + this.config.get<number>('jwt.refreshTtlDays')! * 86400_000);
    const repo = m ? m.getRepository(Session) : this.sessions;
    await repo.insert({
      userId,
      familyId,
      tokenHash: sha256(refreshToken),
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
      ip: meta.ip ?? null,
      expiresAt: refreshExpiresAt,
    });
    return { accessToken: await this.signAccess(userId), refreshToken, refreshExpiresAt };
  }

  /**
   * Refresh-token rotation with reuse detection:
   *  - valid & unused → revoke it, issue a new pair in the same family
   *  - already revoked (replayed) → assume theft, revoke the whole family
   */
  async refresh(rawToken: string | undefined, meta: ClientMeta) {
    if (!rawToken) throw new UnauthorizedException('انتهت الجلسة، من فضلك سجّل الدخول مرة أخرى');
    const hash = sha256(rawToken);
    const outcome = await this.ds.transaction(async (m): Promise<TokenPair | 'REUSED'> => {
      const session = await m
        .getRepository(Session)
        .createQueryBuilder('s')
        .setLock('pessimistic_write')
        .where('s.tokenHash = :hash', { hash })
        .getOne();
      if (!session) throw new UnauthorizedException('انتهت الجلسة، من فضلك سجّل الدخول مرة أخرى');

      if (session.revokedAt) {
        await m.update(Session, { familyId: session.familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
        await this.audit.log(
          { userId: session.userId, action: 'REFRESH_TOKEN_REUSE_DETECTED', entity: 'sessions', entityId: session.familyId, ...meta },
          m,
        );
        // Return (not throw) so the family revocation COMMITS before we reject the request.
        return 'REUSED';
      }
      if (session.expiresAt < new Date()) throw new UnauthorizedException('انتهت الجلسة، من فضلك سجّل الدخول مرة أخرى');

      const user = await m.findOneBy(User, { id: session.userId });
      if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('الحساب غير مفعل');

      const pair = await this.issueTokens(session.userId, meta, session.familyId, m);
      const next = await m.findOneByOrFail(Session, { tokenHash: sha256(pair.refreshToken) });
      await m.update(Session, { id: session.id }, { revokedAt: new Date(), replacedById: next.id, lastUsedAt: new Date() });
      return pair;
    });
    if (outcome === 'REUSED') throw new UnauthorizedException('تم إنهاء الجلسة لأسباب أمنية، سجّل الدخول مرة أخرى');
    return outcome;
  }

  async logout(rawToken: string | undefined, userId?: string) {
    if (rawToken) {
      const s = await this.sessions.findOneBy({ tokenHash: sha256(rawToken) });
      if (s && (!userId || s.userId === userId)) {
        await this.sessions.update({ familyId: s.familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
      }
    }
    return { ok: true };
  }

  /** Revokes every refresh token AND invalidates outstanding access tokens (token_version bump). */
  async logoutAll(userId: string, meta: ClientMeta = {}) {
    await this.sessions.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
    await this.users.increment({ id: userId }, 'tokenVersion', 1);
    this.loader.invalidate(userId);
    await this.audit.log({ userId, action: 'LOGOUT_ALL', entity: 'users', entityId: userId, ...meta });
    return { ok: true };
  }

  async listSessions(userId: string) {
    const rows = await this.sessions.find({
      where: { userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return rows
      .filter((s) => s.expiresAt > new Date())
      .map((s) => ({ id: s.id, device: describeDevice(s.userAgent), userAgent: s.userAgent, ip: s.ip, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, expiresAt: s.expiresAt }));
  }

  /** The account owner's own sign-in & security trail (from the audit log). */
  async loginHistory(userId: string) {
    const rows = await this.ds.query(
      `SELECT action, ip, user_agent, created_at FROM audit_logs
        WHERE user_id = $1 AND action = ANY($2) ORDER BY created_at DESC LIMIT 40`,
      [userId, SECURITY_SELF_ACTIONS],
    );
    return rows.map((r: any) => ({ action: r.action, ip: r.ip, device: describeDevice(r.user_agent), at: r.created_at }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const s = await this.sessions.findOneBy({ id: sessionId, userId });
    if (!s) throw new NotFoundException('الجلسة غير موجودة');
    await this.sessions.update({ familyId: s.familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
    return { ok: true };
  }

  // ─────────────── Passwords ───────────────

  async changePassword(userId: string, dto: ChangePasswordDto, meta: ClientMeta) {
    const user = await this.users.createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id: userId }).getOneOrFail();
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('كلمة المرور الحالية غير صحيحة');
    }
    if (dto.currentPassword === dto.newPassword) throw new BadRequestException('كلمة المرور الجديدة مطابقة للحالية');
    await this.users.update(userId, { passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS) });
    await this.logoutAll(userId, meta);
    await this.audit.log({ userId, action: 'PASSWORD_CHANGED', entity: 'users', entityId: userId, ...meta });
    // Issue fresh tokens so the current device stays signed in.
    const tokens = await this.issueTokens(userId, meta, randomUUID());
    return { ...tokens, user: await this.me(userId) };
  }

  /** Always answers the same way whether or not the account exists (no user enumeration). */
  async forgotPassword(identifier: string, meta: ClientMeta) {
    const phone = normalizePhone(identifier);
    const user = identifier.includes('@')
      ? await this.users.findOneBy({ email: identifier.toLowerCase() })
      : phone
        ? await this.users.findOneBy({ phone })
        : null;
    let devToken: string | undefined;
    if (user && user.status !== UserStatus.SUSPENDED) {
      const token = secureToken(32);
      await this.vtokens.update(
        { userId: user.id, purpose: TokenPurpose.PASSWORD_RESET, consumedAt: IsNull() },
        { consumedAt: new Date() },
      );
      await this.vtokens.insert({
        userId: user.id,
        purpose: TokenPurpose.PASSWORD_RESET,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      });
      const link = `${this.config.get('frontendUrl')}/reset-password?token=${token}`;
      const body = `لإعادة تعيين كلمة المرور اضغط على الرابط التالي (صالح لمدة 30 دقيقة):\n${link}\nإذا لم تطلب ذلك تجاهل هذه الرسالة.`;
      this.jobs.add('auth.send', { userId: user.id, title: 'إعادة تعيين كلمة المرور', body, prefer: user.email ? 'EMAIL' : 'SMS' });
      await this.audit.log({ userId: user.id, action: 'PASSWORD_RESET_REQUESTED', entity: 'users', entityId: user.id, ...meta });
      if (!this.config.get('isProd')) devToken = token;
    }
    return { ok: true, message: 'إذا كان الحساب موجوداً فستصلك رسالة بخطوات إعادة التعيين', ...(devToken ? { devToken } : {}) };
  }

  async resetPassword(dto: ResetPasswordDto, meta: ClientMeta) {
    const hash = sha256(dto.token);
    await this.ds.transaction(async (m) => {
      const t = await m.findOne(VerificationToken, {
        where: { tokenHash: hash, purpose: TokenPurpose.PASSWORD_RESET },
        lock: { mode: 'pessimistic_write' },
      });
      if (!t || t.consumedAt || t.expiresAt < new Date()) throw new BadRequestException('رابط إعادة التعيين غير صالح أو منتهي');
      await m.update(VerificationToken, { id: t.id }, { consumedAt: new Date() });
      await m.update(User, { id: t.userId }, { passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS), failedLoginCount: 0, lockedUntil: null });
      await m.update(Session, { userId: t.userId, revokedAt: IsNull() }, { revokedAt: new Date() });
      await m.increment(User, { id: t.userId }, 'tokenVersion', 1);
      await this.audit.log({ userId: t.userId, action: 'PASSWORD_RESET', entity: 'users', entityId: t.userId, ...meta }, m);
      this.loader.invalidate(t.userId);
    });
    return { ok: true };
  }

  // ─────────────── Email / phone verification ───────────────

  private queueVerification(userId: string) {
    this.requestVerification(userId, 'EMAIL').catch(() => undefined);
  }

  async requestVerification(userId: string, channel: 'EMAIL' | 'PHONE') {
    const user = await this.users.findOneByOrFail({ id: userId });
    if (channel === 'EMAIL' && !user.email) throw new BadRequestException('لا يوجد بريد إلكتروني مسجل');
    if (channel === 'EMAIL' && user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    if (channel === 'PHONE' && user.phoneVerifiedAt) return { ok: true, alreadyVerified: true };

    const purpose = channel === 'EMAIL' ? TokenPurpose.EMAIL_VERIFICATION : TokenPurpose.PHONE_VERIFICATION;
    const token = channel === 'EMAIL' ? secureToken(24) : String(randomInt(100000, 1000000));
    await this.vtokens.update({ userId, purpose, consumedAt: IsNull() }, { consumedAt: new Date() });
    await this.vtokens.insert({
      userId,
      purpose,
      tokenHash: sha256(`${userId}:${token}`),
      expiresAt: new Date(Date.now() + (channel === 'EMAIL' ? 24 * 3600_000 : 10 * 60_000)),
    });
    const body =
      channel === 'EMAIL'
        ? `لتأكيد بريدك الإلكتروني افتح الرابط:\n${this.config.get('frontendUrl')}/verify?token=${token}`
        : `كود التحقق الخاص بك هو ${token} (صالح 10 دقائق)`;
    this.jobs.add('auth.send', { userId, title: 'تأكيد الحساب', body, prefer: channel === 'EMAIL' ? 'EMAIL' : 'SMS' });
    return { ok: true, ...(!this.config.get('isProd') ? { devToken: token } : {}) };
  }

  async confirmVerification(userId: string, token: string) {
    const t = await this.vtokens.findOne({
      where: { tokenHash: sha256(`${userId}:${token}`), userId },
    });
    if (!t || t.consumedAt || t.expiresAt < new Date()) throw new BadRequestException('كود التحقق غير صالح أو منتهي');
    await this.vtokens.update(t.id, { consumedAt: new Date() });
    const field = t.purpose === TokenPurpose.EMAIL_VERIFICATION ? 'emailVerifiedAt' : 'phoneVerifiedAt';
    await this.users.update(userId, { [field]: new Date() });
    return { ok: true, verified: t.purpose };
  }

  registerJobs() {
    this.jobs.register<{ userId: string; title: string; body: string; prefer: 'EMAIL' | 'SMS' }>('auth.send', async (p) => {
      const user = await this.users.findOneBy({ id: p.userId });
      if (!user) return;
      const to = { email: user.email, phone: user.phone, name: user.fullName };
      if (p.prefer === 'EMAIL' && user.email) await this.email.send({ to, title: p.title, body: p.body });
      else await this.sms.send({ to, title: p.title, body: p.body });
    });
  }

  // ─────────────── Profile ───────────────

  async me(userId: string) {
    const user = await this.users.findOne({ where: { id: userId }, relations: { roles: true } });
    if (!user) throw new NotFoundException();
    this.loader.invalidate(userId);
    const principal = await this.loader.load(userId);
    const providers = principal!.providerIds.length
      ? await this.ds.getRepository(Provider).find({
          where: { id: In(principal!.providerIds) },
          select: { id: true, type: true, nameAr: true, slug: true, verificationStatus: true, isActive: true },
        })
      : [];
    return {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      status: user.status,
      locale: user.locale,
      avatarFileId: user.avatarFileId,
      emailVerified: !!user.emailVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt,
      roles: user.roles.map((r) => r.code),
      permissions: [...principal!.permissions].sort(),
      patientId: principal!.patientId,
      doctorId: principal!.doctorId,
      providers,
      profileCompleted: user.profileCompleted,
      twoFactorEnabled: user.twoFactorEnabled,
      twoFactorSetupRequired: !!principal!.twoFactorSetupRequired,
      subscription: principal!.subscription
        ? { blocked: principal!.subscription.blocked, endsAt: principal!.subscription.endsAt, providerId: principal!.subscription.providerId, canPay: principal!.adminProviderIds.includes(principal!.subscription.providerId ?? '') }
        : null,
      createdAt: user.createdAt,
    };
  }
}
