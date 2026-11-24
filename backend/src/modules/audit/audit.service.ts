import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from '../../database/entities';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

const REDACT = /password|token|secret|hash/i;
function redact(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(redact);
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, REDACT.test(k) ? '[REDACTED]' : redact(val)]),
  );
}

/**
 * Append-only audit trail (UPDATE is blocked by a DB trigger). Pass an
 * EntityManager to write inside the caller's transaction so the audit row
 * commits/rolls back atomically with the change it describes.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditLog) private repo: Repository<AuditLog>) {}

  async log(entry: AuditEntry, manager?: EntityManager) {
    const row: any = {
      userId: entry.userId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      oldValue: entry.oldValue === undefined ? null : redact(entry.oldValue),
      newValue: entry.newValue === undefined ? null : redact(entry.newValue),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ? entry.userAgent.slice(0, 255) : null,
    };
    try {
      if (manager) await manager.insert(AuditLog, row);
      else await this.repo.insert(row);
    } catch (e) {
      // Inside a transaction the error must propagate; outside, never break the request.
      if (manager) throw e;
      this.logger.error(`Failed to write audit log ${entry.action}: ${(e as Error).message}`);
    }
  }
}
