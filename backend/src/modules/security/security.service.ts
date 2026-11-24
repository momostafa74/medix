import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/auth-user';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { describeDevice } from '../../common/utils/security';
import { AuditService } from '../audit/audit.service';
import { AuthUserLoader, PLATFORM_ROLES } from '../auth/auth-user.loader';
import { TwoFactorService } from '../auth/two-factor.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

/** Audit actions that make up the security event feed. */
export const SECURITY_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGIN_BLOCKED_LOCKED',
  'ACCOUNT_LOCKED',
  'ACCOUNT_UNLOCKED',
  'NEW_DEVICE_LOGIN',
  'REFRESH_TOKEN_REUSE_DETECTED',
  'TWO_FACTOR_ENABLED',
  'TWO_FACTOR_DISABLED',
  'TWO_FACTOR_FAILED',
  'TWO_FACTOR_BACKUP_CODE_USED',
  'TWO_FACTOR_RESET_BY_ADMIN',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'FORCE_LOGOUT',
  'LOGOUT_ALL',
];
/** Events worth a reviewer's attention (the rest are routine). */
const ALERT_ACTIONS = ['ACCOUNT_LOCKED', 'REFRESH_TOKEN_REUSE_DETECTED', 'TWO_FACTOR_DISABLED', 'TWO_FACTOR_RESET_BY_ADMIN', 'LOGIN_BLOCKED_LOCKED'];

@Injectable()
export class SecurityService {
  constructor(
    private ds: DataSource,
    private audit: AuditService,
    private settings: SettingsService,
    private twoFactor: TwoFactorService,
    private loader: AuthUserLoader,
    private notifications: NotificationsService,
  ) {}

  async overview(days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const counts: { action: string; n: number }[] = await this.ds.query(
      `SELECT action, count(*)::int AS n FROM audit_logs WHERE created_at >= $1 AND action = ANY($2) GROUP BY action`,
      [since, SECURITY_ACTIONS],
    );
    const c = (a: string) => counts.find((x) => x.action === a)?.n ?? 0;
    const daily = await this.ds.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date,
              count(a.*) FILTER (WHERE a.action = 'LOGIN')::int AS success,
              count(a.*) FILTER (WHERE a.action IN ('LOGIN_FAILED', 'TWO_FACTOR_FAILED', 'LOGIN_BLOCKED_LOCKED'))::int AS failed
         FROM generate_series(date_trunc('day', $1::timestamptz), date_trunc('day', now()), interval '1 day') d
         LEFT JOIN audit_logs a ON a.created_at >= d AND a.created_at < d + interval '1 day'
              AND a.action IN ('LOGIN', 'LOGIN_FAILED', 'TWO_FACTOR_FAILED', 'LOGIN_BLOCKED_LOCKED')
        GROUP BY d ORDER BY d`,
      [since],
    );
    const topIps = await this.ds.query(
      `SELECT ip, count(*)::int AS failures, count(DISTINCT coalesce(user_id::text, new_value->>'identifier'))::int AS accounts, max(created_at) AS last_at
         FROM audit_logs WHERE created_at >= $1 AND action IN ('LOGIN_FAILED', 'TWO_FACTOR_FAILED') AND ip IS NOT NULL
        GROUP BY ip ORDER BY failures DESC LIMIT 10`,
      [since],
    );
    const locked = await this.ds.query(
      `SELECT id, full_name, phone, email, locked_until FROM users WHERE locked_until > now() ORDER BY locked_until DESC LIMIT 50`,
    );
    const staff = await this.ds.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.two_factor_enabled, u.last_login_at, array_agg(DISTINCT r.code) AS roles
         FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
        WHERE r.code = ANY($1) AND u.status = 'ACTIVE'
        GROUP BY u.id ORDER BY u.two_factor_enabled, u.full_name`,
      [PLATFORM_ROLES],
    );
    const [twoFa] = await this.ds.query(`SELECT count(*) FILTER (WHERE two_factor_enabled)::int AS enabled, count(*)::int AS total FROM users WHERE status = 'ACTIVE'`);
    const policy = {
      maxFailedLogins: await this.settings.get<number>('security.maxFailedLogins'),
      lockMinutes: await this.settings.get<number>('security.lockMinutes'),
      require2faForStaff: await this.settings.get<boolean>('security.require2faForStaff'),
      newDeviceAlerts: await this.settings.get<boolean>('security.newDeviceAlerts'),
      auditRetentionDays: await this.settings.get<number>('audit.retentionDays'),
    };
    return {
      days,
      totals: {
        logins: c('LOGIN'),
        failedLogins: c('LOGIN_FAILED') + c('TWO_FACTOR_FAILED'),
        lockouts: c('ACCOUNT_LOCKED'),
        blockedWhileLocked: c('LOGIN_BLOCKED_LOCKED'),
        newDevices: c('NEW_DEVICE_LOGIN'),
        tokenReuse: c('REFRESH_TOKEN_REUSE_DETECTED'),
        passwordResets: c('PASSWORD_RESET'),
        twoFactorEnabledUsers: twoFa.enabled,
        activeUsers: twoFa.total,
      },
      daily,
      topIps: topIps.map((r: any) => ({ ip: r.ip, failures: r.failures, accounts: r.accounts, lastAt: r.last_at })),
      locked: locked.map((r: any) => ({ id: r.id, fullName: r.full_name, phone: r.phone, email: r.email, lockedUntil: r.locked_until })),
      staff: staff.map((r: any) => ({ id: r.id, fullName: r.full_name, email: r.email, phone: r.phone, roles: r.roles, twoFactorEnabled: r.two_factor_enabled, lastLoginAt: r.last_login_at })),
      policy,
    };
  }

  async events(q: { page?: number; pageSize?: number; action?: string; alertsOnly?: boolean; userId?: string; ip?: string }) {
    const where = ['a.action = ANY($1)'];
    const params: unknown[] = [q.action ? [q.action] : q.alertsOnly ? ALERT_ACTIONS : SECURITY_ACTIONS];
    if (q.userId) {
      params.push(q.userId);
      where.push(`a.user_id = $${params.length}`);
    }
    if (q.ip) {
      params.push(q.ip);
      where.push(`a.ip = $${params.length}`);
    }
    const cond = where.join(' AND ');
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM audit_logs a WHERE ${cond}`, params);
    const { skip, take } = skipTake(q as any);
    const rows = await this.ds.query(
      `SELECT a.id, a.action, a.ip, a.user_agent, a.created_at, a.user_id, a.new_value, u.full_name, u.phone
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE ${cond} ORDER BY a.created_at DESC LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return paginate(
      rows.map((r: any) => ({
        id: r.id,
        action: r.action,
        alert: ALERT_ACTIONS.includes(r.action),
        ip: r.ip,
        device: describeDevice(r.user_agent),
        at: r.created_at,
        user: r.user_id ? { id: r.user_id, fullName: r.full_name, phone: r.phone } : null,
        // Failed logins for unknown accounts: show what was typed (never passwords — the audit service redacts those).
        identifier: !r.user_id ? r.new_value?.identifier ?? null : null,
      })),
      total,
      q as any,
    );
  }

  private async user(id: string) {
    const [u] = await this.ds.query(`SELECT id, full_name, locked_until, two_factor_enabled FROM users WHERE id = $1`, [id]);
    if (!u) throw new NotFoundException('المستخدم غير موجود');
    return u;
  }

  async unlock(admin: AuthUser, id: string, meta: Meta) {
    const u = await this.user(id);
    if (!u.locked_until || new Date(u.locked_until) <= new Date()) throw new BadRequestException('الحساب غير مقفول');
    await this.ds.query(`UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE id = $1`, [id]);
    await this.audit.log({ userId: admin.id, action: 'ACCOUNT_UNLOCKED', entity: 'users', entityId: id, ...meta });
    return { ok: true };
  }

  resetTwoFactor(admin: AuthUser, id: string, reason: string, meta: Meta) {
    return this.twoFactor.adminReset(admin.id, id, reason, meta);
  }

  /** Ends every session of an account (stolen phone, leaked password). */
  async forceLogout(admin: AuthUser, id: string, meta: Meta) {
    await this.user(id);
    await this.ds.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [id]);
    await this.ds.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
    this.loader.invalidate(id);
    await this.audit.log({ userId: admin.id, action: 'FORCE_LOGOUT', entity: 'users', entityId: id, ...meta });
    await this.notifications.notify(id, { type: 'FORCE_LOGOUT', category: 'SYSTEM', title: 'تم تسجيل خروجك من كل الأجهزة', body: 'أنهى فريق الدعم كل الجلسات المفتوحة لحسابك لحمايته. سجّل الدخول من جديد.', force: true });
    return { ok: true };
  }
}
