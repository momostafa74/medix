import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  Notification,
  NotificationChannel,
  NotificationPreference,
  NotificationStatus,
  User,
} from '../../database/entities';
import { JobQueueService } from '../../common/jobs/job-queue.service';
import { EmailChannel, NotificationChannelAdapter, SmsChannel, WhatsAppChannel } from './channels';
import { NotificationsGateway } from './notifications.gateway';
import { SettingsService } from '../settings/settings.service';

export const NOTIFICATION_CATEGORIES = [
  'APPOINTMENTS',
  'CHAT',
  'LAB_RESULTS',
  'RADIOLOGY',
  'PRESCRIPTIONS',
  'PHARMACY',
  'PAYMENTS',
  'SYSTEM',
  'MARKETING',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Defaults when a user has not set a preference. */
const DEFAULTS: Record<NotificationChannel, (c: string) => boolean> = {
  [NotificationChannel.IN_APP]: (c) => c !== 'MARKETING',
  [NotificationChannel.EMAIL]: (c) => ['APPOINTMENTS', 'LAB_RESULTS', 'RADIOLOGY', 'PAYMENTS', 'SYSTEM'].includes(c),
  [NotificationChannel.SMS]: (c) => c === 'APPOINTMENTS',
  [NotificationChannel.WHATSAPP]: () => false,
};

export interface NotifyInput {
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** SYSTEM-critical messages bypass preferences for in-app. */
  force?: boolean;
}

/**
 * Centralised Notification Service. Every module calls `notify()`; the service
 * decides channels from user preferences, persists the in-app copy, pushes it
 * over Socket.IO, and queues external deliveries as background jobs.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private adapters: NotificationChannelAdapter[];

  constructor(
    @InjectRepository(Notification) private repo: Repository<Notification>,
    @InjectRepository(NotificationPreference) private prefs: Repository<NotificationPreference>,
    @InjectRepository(User) private users: Repository<User>,
    private gateway: NotificationsGateway,
    private jobs: JobQueueService,
    private settings: SettingsService,
    email: EmailChannel,
    sms: SmsChannel,
    whatsapp: WhatsAppChannel,
  ) {
    this.adapters = [email, sms, whatsapp];
  }

  onModuleInit() {
    this.jobs.register<{ userId: string; channel: string; title: string; body: string }>(
      'notification.deliver',
      async (p) => {
        const user = await this.users.findOne({ where: { id: p.userId } });
        const adapter = this.adapters.find((a) => a.name === p.channel);
        if (!user || !adapter) return;
        await adapter.send({ to: { email: user.email, phone: user.phone, name: user.fullName }, title: p.title, body: p.body });
      },
    );
  }

  async isEnabled(userId: string, category: string, channel: NotificationChannel) {
    const pref = await this.prefs.findOne({ where: { userId, category, channel } });
    return pref ? pref.enabled : DEFAULTS[channel](category);
  }

  /** Admin-level kill switches applied on top of user preferences. */
  private async globallyAllowed(channel: NotificationChannel, category: string) {
    if (category === 'MARKETING' && !(await this.settings.get<boolean>('notifications.marketingEnabled'))) return false;
    if (channel === NotificationChannel.EMAIL) return this.settings.get<boolean>('notifications.emailEnabled');
    if (channel === NotificationChannel.SMS) return this.settings.get<boolean>('notifications.smsEnabled');
    if (channel === NotificationChannel.WHATSAPP) return this.settings.get<boolean>('notifications.whatsappEnabled');
    return true;
  }

  async notify(userId: string, input: NotifyInput) {
    let saved: Notification | null = null;
    if (!(await this.globallyAllowed(NotificationChannel.IN_APP, input.category))) return null;
    if (input.force || (await this.isEnabled(userId, input.category, NotificationChannel.IN_APP))) {
      saved = await this.repo.save(
        this.repo.create({
          userId,
          type: input.type,
          category: input.category,
          channel: NotificationChannel.IN_APP,
          title: input.title,
          body: input.body,
          data: input.data ?? null,
          status: NotificationStatus.SENT,
        }),
      );
      this.gateway.emitToUser(userId, 'notification', saved);
    }
    for (const channel of [NotificationChannel.EMAIL, NotificationChannel.SMS, NotificationChannel.WHATSAPP]) {
      if ((await this.globallyAllowed(channel, input.category)) && (await this.isEnabled(userId, input.category, channel))) {
        this.jobs.add('notification.deliver', { userId, channel, title: input.title, body: input.body });
      }
    }
    return saved;
  }

  async notifyMany(userIds: string[], input: NotifyInput) {
    for (const id of new Set(userIds)) await this.notify(id, input);
  }

  async list(userId: string, page: number, pageSize: number, unreadOnly: boolean) {
    const where: any = { userId };
    if (unreadOnly) where.readAt = IsNull();
    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  unreadCount(userId: string) {
    return this.repo.count({ where: { userId, readAt: IsNull() } });
  }

  async markRead(userId: string, id: string) {
    // Ownership enforced in the WHERE clause — another user's id simply matches nothing.
    const res = await this.repo.update({ id, userId }, { readAt: new Date(), status: NotificationStatus.READ });
    if (!res.affected) throw new NotFoundException('الإشعار غير موجود');
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.repo.update({ userId, readAt: IsNull() }, { readAt: new Date(), status: NotificationStatus.READ });
    return { ok: true };
  }

  async getPreferences(userId: string) {
    const stored = await this.prefs.find({ where: { userId } });
    const channels = Object.values(NotificationChannel);
    return NOTIFICATION_CATEGORIES.map((category) => ({
      category,
      channels: Object.fromEntries(
        channels.map((ch) => {
          const p = stored.find((s) => s.category === category && s.channel === ch);
          return [ch, p ? p.enabled : DEFAULTS[ch](category)];
        }),
      ),
    }));
  }

  async setPreferences(userId: string, items: { category: string; channel: NotificationChannel; enabled: boolean }[]) {
    const valid = items.filter((i) => (NOTIFICATION_CATEGORIES as readonly string[]).includes(i.category));
    if (valid.length) {
      await this.prefs.upsert(
        valid.map((i) => ({ userId, category: i.category, channel: i.channel, enabled: i.enabled })),
        ['userId', 'category', 'channel'],
      );
    }
    return this.getPreferences(userId);
  }
}
