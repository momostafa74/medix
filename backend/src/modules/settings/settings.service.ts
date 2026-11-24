import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../../database/entities';
import { AuditService } from '../audit/audit.service';

type Validator = (v: unknown) => boolean;
const str = (max = 200): Validator => (v) => typeof v === 'string' && v.length <= max;
const int = (min: number, max: number): Validator => (v) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const bool: Validator = (v) => typeof v === 'boolean';

/** Whitelisted settings with validation + defaults. `public` ones are exposed unauthenticated. */
export const SETTINGS: Record<string, { default: unknown; validate: Validator; public?: boolean }> = {
  'platform.name': { default: 'ميديكس', validate: str(60), public: true },
  'platform.supportPhone': { default: '+201000000000', validate: str(30), public: true },
  'platform.supportEmail': { default: 'support@medix.local', validate: str(120), public: true },
  'platform.currency': { default: 'EGP', validate: str(5), public: true },
  'booking.minLeadMinutes': { default: 30, validate: int(0, 1440), public: true },
  'booking.maxActivePerPatient': { default: 10, validate: int(1, 100) },
  'providers.requireApproval': { default: true, validate: bool },
  'emergency.hotline': { default: '123', validate: str(20), public: true },
  // Global notification rules (override individual user preferences)
  'notifications.emailEnabled': { default: true, validate: bool },
  'notifications.smsEnabled': { default: true, validate: bool },
  'notifications.whatsappEnabled': { default: false, validate: bool },
  'notifications.marketingEnabled': { default: false, validate: bool },
  'appointments.reminderHours': { default: 24, validate: int(1, 72) },
  // Laboratories
  'lab.maxActiveOrdersPerPatient': { default: 5, validate: int(1, 50) },
  /** Alert lab managers the moment a critical value is entered, and flag it to the patient on approval. */
  'lab.criticalAlertsEnabled': { default: true, validate: bool },
  // Radiology
  'radiology.maxActiveOrdersPerPatient': { default: 5, validate: int(1, 50) },
  // Prescriptions & pharmacy
  'prescriptions.defaultValidityDays': { default: 30, validate: int(1, 365) },
  'pharmacy.maxOpenOrdersPerPatient': { default: 5, validate: int(1, 50) },
  // Provider subscriptions & payments (Phase 7)
  /** Off = nobody is ever locked out (e.g. during launch). */
  'subscriptions.enabled': { default: true, validate: bool },
  'subscriptions.trialDays': { default: 14, validate: int(0, 180) },
  /** Days after the period ends before the account is locked. */
  'subscriptions.graceDays': { default: 3, validate: int(0, 30) },
  'subscriptions.reminderDays': { default: 5, validate: int(1, 30) },
  'payments.onlineEnabled': { default: true, validate: bool, public: true },
  'payments.instapay': { default: 'medix@instapay', validate: str(80), public: true },
  'payments.vodafoneCash': { default: '01000000000', validate: str(30), public: true },
  'payments.bankAccount': { default: 'بنك مصر — حساب رقم 0000000000 — باسم ميديكس', validate: str(200), public: true },
  // Security (Phase 8)
  /** Wrong passwords in a row before the account is locked. */
  'security.maxFailedLogins': { default: 5, validate: int(3, 20) },
  'security.lockMinutes': { default: 15, validate: int(1, 1440) },
  /** Platform staff (admin, support, accountant) must turn on two-step verification before using the dashboard. */
  'security.require2faForStaff': { default: false, validate: bool },
  /** In-app + email notice when an account signs in from a device it never used. */
  'security.newDeviceAlerts': { default: true, validate: bool },
  /** Audit rows older than this are purged nightly (0 = keep forever). */
  'audit.retentionDays': { default: 730, validate: int(0, 3650) },
};

@Injectable()
export class SettingsService {
  private cache = new Map<string, { v: unknown; at: number }>();
  private listeners: ((key: string) => void)[] = [];

  /** Lets other services react to a change (e.g. re-evaluate signed-in principals). */
  onChange(fn: (key: string) => void) {
    this.listeners.push(fn);
  }

  constructor(
    @InjectRepository(SystemSetting) private repo: Repository<SystemSetting>,
    private audit: AuditService,
  ) {}

  async get<T = unknown>(key: string): Promise<T> {
    const def = SETTINGS[key];
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < 30_000) return c.v as T;
    const row = await this.repo.findOne({ where: { key } });
    const v = row ? row.value : def?.default;
    this.cache.set(key, { v, at: Date.now() });
    return v as T;
  }

  async all(onlyPublic = false) {
    const rows = await this.repo.find();
    const out: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(SETTINGS)) {
      if (onlyPublic && !def.public) continue;
      const r = rows.find((x) => x.key === key);
      out[key] = r ? r.value : def.default;
    }
    return out;
  }

  async set(key: string, value: unknown, userId: string) {
    const def = SETTINGS[key];
    if (!def) throw new BadRequestException('إعداد غير معروف');
    if (!def.validate(value)) throw new BadRequestException('قيمة غير صالحة لهذا الإعداد');
    const old = await this.get(key);
    await this.repo.upsert({ key, value: value as any, updatedById: userId }, ['key']);
    this.cache.delete(key);
    for (const fn of this.listeners) fn(key);
    await this.audit.log({ userId, action: 'SETTING_UPDATED', entity: 'system_settings', entityId: key, oldValue: { value: old }, newValue: { value } });
    return { key, value };
  }
}
