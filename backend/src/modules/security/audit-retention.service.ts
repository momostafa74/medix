import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';

/**
 * Nightly purge of audit rows older than `audit.retentionDays` (0 = keep forever).
 * Deletes in batches so the table is never locked for long. Rows cannot be edited — only aged out.
 */
@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger('AuditRetention');

  constructor(
    private ds: DataSource,
    private settings: SettingsService,
    private audit: AuditService,
  ) {}

  @Cron('30 3 * * *', { name: 'audit-retention', timeZone: 'Africa/Cairo' })
  async purge() {
    const days = await this.settings.get<number>('audit.retentionDays');
    if (!days) return 0;
    let total = 0;
    for (;;) {
      const [, n] = await this.ds.query(
        `DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE created_at < now() - make_interval(days => $1::int) LIMIT 5000)`,
        [days],
      );
      total += n ?? 0;
      if (!n || n < 5000) break;
    }
    if (total) {
      this.logger.log(`Purged ${total} audit rows older than ${days} days`);
      await this.audit.log({ action: 'AUDIT_RETENTION_PURGE', entity: 'audit_logs', newValue: { deleted: total, olderThanDays: days } });
    }
    return total;
  }
}
