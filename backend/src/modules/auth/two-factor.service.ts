import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as QRCode from 'qrcode';
import { DataSource } from 'typeorm';
import { User } from '../../database/entities';
import {
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  otpauthUrl,
  verifyTotp,
} from '../../common/utils/totp';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { AuthUserLoader } from './auth-user.loader';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

const CHALLENGE_TTL = '5m';

/**
 * Two-step verification (TOTP authenticator apps + one-time backup codes).
 * Secrets are encrypted at rest; a code can never be used twice.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private ds: DataSource,
    private jwt: JwtService,
    private config: ConfigService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private settings: SettingsService,
    private loader: AuthUserLoader,
  ) {}

  private key() {
    return this.config.get<string>('security.encryptionKey')!;
  }

  private async withSecrets(userId: string) {
    const u = await this.ds
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect(['u.twoFactorSecret', 'u.twoFactorBackupCodes', 'u.twoFactorLastStep', 'u.passwordHash'])
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!u) throw new NotFoundException();
    return u;
  }

  /** Step 1: a fresh secret (not active until confirmed with a code). */
  async setup(userId: string) {
    const u = await this.withSecrets(userId);
    if (u.twoFactorEnabled) throw new ConflictException({ message: 'التحقق بخطوتين مفعل بالفعل', code: 'TWO_FACTOR_ALREADY_ENABLED' });
    const secret = generateTotpSecret();
    await this.ds.getRepository(User).update(userId, { twoFactorSecret: encryptSecret(secret, this.key()) });
    const issuer = await this.settings.get<string>('platform.name');
    const url = otpauthUrl(secret, u.email || u.phone, `Medix ${issuer}`.trim());
    return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
  }

  /** Step 2: confirm with the first code → enabled, backup codes shown once. */
  async enable(userId: string, code: string, meta: Meta) {
    const u = await this.withSecrets(userId);
    if (u.twoFactorEnabled) throw new ConflictException({ message: 'التحقق بخطوتين مفعل بالفعل', code: 'TWO_FACTOR_ALREADY_ENABLED' });
    if (!u.twoFactorSecret) throw new BadRequestException('ابدأ الإعداد أولاً');
    const step = verifyTotp(decryptSecret(u.twoFactorSecret, this.key()), code);
    if (step === null) throw new BadRequestException({ message: 'الكود غير صحيح — تأكد من ضبط الوقت على موبايلك', code: 'INVALID_2FA_CODE' });
    const backupCodes = generateBackupCodes();
    await this.ds.getRepository(User).update(userId, {
      twoFactorEnabled: true,
      twoFactorEnabledAt: new Date(),
      twoFactorLastStep: String(step),
      twoFactorBackupCodes: backupCodes.map(hashBackupCode),
    });
    this.loader.invalidate(userId);
    await this.audit.log({ userId, action: 'TWO_FACTOR_ENABLED', entity: 'users', entityId: userId, ...meta });
    await this.notifications.notify(userId, { type: 'TWO_FACTOR_ENABLED', category: 'SYSTEM', title: 'تم تفعيل التحقق بخطوتين', body: 'من الآن هيُطلب منك كود من تطبيق المصادقة عند تسجيل الدخول.', force: true });
    return { backupCodes };
  }

  /** Validates a TOTP or backup code and consumes it. Row-locked so one code cannot log in twice concurrently. */
  async consume(userId: string, code: string): Promise<'TOTP' | 'BACKUP' | null> {
    return this.ds.transaction(async (m) => {
      const [row] = await m.query(
        `SELECT two_factor_secret, two_factor_backup_codes, two_factor_last_step, two_factor_enabled FROM users WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      if (!row?.two_factor_enabled || !row.two_factor_secret) return null;
      const clean = String(code || '').trim();
      if (/^\d{6}$/.test(clean.replace(/\s/g, ''))) {
        const step = verifyTotp(decryptSecret(row.two_factor_secret, this.key()), clean);
        if (step === null || (row.two_factor_last_step != null && step <= Number(row.two_factor_last_step))) return null;
        await m.query(`UPDATE users SET two_factor_last_step = $2 WHERE id = $1`, [userId, step]);
        return 'TOTP';
      }
      const codes: string[] = row.two_factor_backup_codes ?? [];
      const h = hashBackupCode(clean);
      if (!codes.includes(h)) return null;
      await m.query(`UPDATE users SET two_factor_backup_codes = $2::jsonb WHERE id = $1`, [userId, JSON.stringify(codes.filter((x) => x !== h))]);
      return 'BACKUP';
    });
  }

  async backupCodesLeft(userId: string) {
    const u = await this.withSecrets(userId);
    return u.twoFactorBackupCodes?.length ?? 0;
  }

  async regenerateBackupCodes(userId: string, code: string, meta: Meta) {
    if ((await this.consume(userId, code)) !== 'TOTP') throw new BadRequestException({ message: 'أدخل كوداً صحيحاً من تطبيق المصادقة', code: 'INVALID_2FA_CODE' });
    const backupCodes = generateBackupCodes();
    await this.ds.getRepository(User).update(userId, { twoFactorBackupCodes: backupCodes.map(hashBackupCode) });
    await this.audit.log({ userId, action: 'TWO_FACTOR_BACKUP_CODES_REGENERATED', entity: 'users', entityId: userId, ...meta });
    return { backupCodes };
  }

  async disable(userId: string, password: string, code: string, meta: Meta) {
    const u = await this.withSecrets(userId);
    if (!u.twoFactorEnabled) throw new BadRequestException('التحقق بخطوتين غير مفعل');
    if (!(await bcrypt.compare(password, u.passwordHash))) throw new UnauthorizedException({ message: 'كلمة المرور غير صحيحة', code: 'INVALID_PASSWORD' });
    if (!(await this.consume(userId, code))) throw new BadRequestException({ message: 'الكود غير صحيح', code: 'INVALID_2FA_CODE' });
    await this.clear(userId);
    await this.audit.log({ userId, action: 'TWO_FACTOR_DISABLED', entity: 'users', entityId: userId, ...meta });
    await this.notifications.notify(userId, { type: 'TWO_FACTOR_DISABLED', category: 'SYSTEM', title: 'تم إيقاف التحقق بخطوتين', body: 'لو مش إنت اللي عملت كده غيّر كلمة المرور فوراً وتواصل مع الدعم.', force: true });
    return { ok: true };
  }

  /** Support resets it when a user lost their phone and backup codes (identity checked offline). */
  async adminReset(adminId: string, userId: string, reason: string, meta: Meta) {
    const u = await this.ds.getRepository(User).findOneBy({ id: userId });
    if (!u) throw new NotFoundException('المستخدم غير موجود');
    if (!u.twoFactorEnabled) throw new BadRequestException('التحقق بخطوتين غير مفعل لهذا الحساب');
    await this.clear(userId);
    // Existing sessions may have been opened by whoever has the device — end them.
    await this.ds.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [userId]);
    await this.ds.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    await this.audit.log({ userId: adminId, action: 'TWO_FACTOR_RESET_BY_ADMIN', entity: 'users', entityId: userId, newValue: { reason }, ...meta });
    await this.notifications.notify(userId, { type: 'TWO_FACTOR_RESET', category: 'SYSTEM', title: 'تمت إعادة ضبط التحقق بخطوتين', body: 'أعاد فريق الدعم ضبط التحقق بخطوتين لحسابك. سجّل الدخول وفعّله من جديد.', force: true });
    return { ok: true };
  }

  private async clear(userId: string) {
    await this.ds.getRepository(User).update(userId, { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: null, twoFactorLastStep: null, twoFactorEnabledAt: null });
    this.loader.invalidate(userId);
  }

  // ─── Login challenge ───

  /** Signed with a key derived from (but different to) the access secret, so it can never pass as an access token. */
  private challengeSecret() {
    return `${this.config.get<string>('jwt.accessSecret')}:two-factor-challenge`;
  }

  challengeToken(user: { id: string; tokenVersion: number }) {
    return this.jwt.signAsync({ sub: user.id, tv: user.tokenVersion, purpose: '2fa' }, { secret: this.challengeSecret(), expiresIn: CHALLENGE_TTL, algorithm: 'HS256' });
  }

  async readChallenge(token: string): Promise<string> {
    try {
      const p = await this.jwt.verifyAsync(token, { secret: this.challengeSecret(), algorithms: ['HS256'] });
      if (p.purpose !== '2fa') throw new Error('wrong purpose');
      const [u] = await this.ds.query(`SELECT token_version FROM users WHERE id = $1`, [p.sub]);
      if (!u || u.token_version !== p.tv) throw new Error('stale');
      return p.sub as string;
    } catch {
      throw new UnauthorizedException({ message: 'انتهت مهلة التحقق، سجّل الدخول مرة أخرى', code: 'TWO_FACTOR_CHALLENGE_EXPIRED' });
    }
  }
}
