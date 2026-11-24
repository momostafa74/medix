import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/auth-user';
import { UserStatus } from '../../database/entities';
import { SettingsService } from '../settings/settings.service';

/** Roles whose access depends on their provider's monthly subscription (patients and platform staff never do). */
export const SUBSCRIBER_ROLES = ['DOCTOR', 'LAB_ADMIN', 'LAB_STAFF', 'RADIOLOGY_ADMIN', 'RADIOLOGY_STAFF', 'PHARMACY_ADMIN', 'PHARMACY_STAFF'];
export const PLATFORM_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'ACCOUNTANT'];

interface Cached {
  user: AuthUser & { status: UserStatus; tokenVersion: number };
  at: number;
}

/**
 * Builds the request principal from the DATABASE on every request (with a very
 * short cache), so role changes, deactivation and forced logout take effect
 * immediately instead of waiting for token expiry.
 */
@Injectable()
export class AuthUserLoader {
  private cache = new Map<string, Cached>();
  private readonly ttlMs = 10_000;

  constructor(
    private ds: DataSource,
    private settings: SettingsService,
  ) {
    // Access rules derived from settings (subscription lockout, staff 2FA) apply on the next request.
    settings.onChange((key) => {
      if (key.startsWith('security.') || key.startsWith('subscriptions.')) this.invalidateAll();
    });
  }

  invalidate(userId: string) {
    this.cache.delete(userId);
  }

  /** After a subscription change every account of the provider must be re-evaluated. */
  invalidateAll() {
    this.cache.clear();
  }

  async load(userId: string): Promise<Cached['user'] | null> {
    const c = this.cache.get(userId);
    if (c && Date.now() - c.at < this.ttlMs) return c.user;

    const [row] = await this.ds.query(
      `SELECT u.id, u.full_name, u.status, u.token_version, u.two_factor_enabled,
              p.id AS patient_id, d.id AS doctor_id
         FROM users u
         LEFT JOIN patients p ON p.user_id = u.id
         LEFT JOIN doctors d ON d.user_id = u.id
        WHERE u.id = $1`,
      [userId],
    );
    if (!row) return null;
    const roles: { code: string }[] = await this.ds.query(
      `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
      [userId],
    );
    const perms: { code: string }[] = await this.ds.query(
      `SELECT DISTINCT p.code FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = $1`,
      [userId],
    );
    const providers: { id: string; is_admin: boolean }[] = await this.ds.query(
      `SELECT id, true AS is_admin FROM providers WHERE owner_user_id = $1
       UNION
       SELECT provider_id AS id, is_admin FROM provider_staff WHERE user_id = $1 AND is_active`,
      [userId],
    );
    const roleCodes = roles.map((r) => r.code);
    const providerIds = [...new Set(providers.map((p) => p.id))];
    let subscription: Cached['user']['subscription'];
    if (providerIds.length && roleCodes.some((r) => SUBSCRIBER_ROLES.includes(r)) && !roleCodes.some((r) => PLATFORM_ROLES.includes(r))) {
      const subs: { id: string; ends: Date | null }[] = await this.ds.query(
        `SELECT p.id, coalesce(p.subscription_ends_at, s.current_period_end) AS ends
           FROM providers p LEFT JOIN provider_subscriptions s ON s.provider_id = p.id WHERE p.id = ANY($1::uuid[]) ORDER BY 2 DESC NULLS LAST`,
        [providerIds],
      );
      const enabled = await this.settings.get<boolean>('subscriptions.enabled');
      const grace = await this.settings.get<number>('subscriptions.graceDays');
      const best = subs[0];
      const ends = best?.ends ? new Date(best.ends) : null;
      // No row yet (legacy data) counts as active until the job creates the trial.
      const blocked = enabled && !!best && (!ends || Date.now() > ends.getTime() + grace * 86_400_000) && subs.every((x) => x.ends);
      subscription = { blocked, endsAt: ends, providerId: best?.id ?? null };
    }
    // Platform staff may be required to use two-step verification (security.require2faForStaff).
    const isStaff = roleCodes.some((r) => PLATFORM_ROLES.includes(r));
    const twoFactorSetupRequired = isStaff && !row.two_factor_enabled && (await this.settings.get<boolean>('security.require2faForStaff'));
    const user = {
      id: row.id,
      fullName: row.full_name,
      status: row.status,
      tokenVersion: row.token_version,
      roles: roleCodes,
      permissions: new Set(perms.map((p) => p.code)),
      patientId: row.patient_id,
      doctorId: row.doctor_id,
      providerIds,
      adminProviderIds: [...new Set(providers.filter((p) => p.is_admin).map((p) => p.id))],
      subscription,
      twoFactorEnabled: !!row.two_factor_enabled,
      twoFactorSetupRequired,
    };
    this.cache.set(userId, { user, at: Date.now() });
    if (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value as string);
    return user;
  }
}
