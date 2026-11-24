import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { monitorEventLoopDelay } from 'perf_hooks';
import * as os from 'os';
import { DataSource } from 'typeorm';
import { CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { CacheService } from '../../common/cache/cache.service';
import { JobQueueService } from '../../common/jobs/job-queue.service';
import { P } from '../../common/permissions';
import { AuditService } from '../audit/audit.service';
import { PdfService } from '../pdf/pdf.service';
import { metrics } from './metrics';

const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
const mb = (b: number) => Math.round((b / 1024 / 1024) * 10) / 10;

@ApiTags('System')
@ApiBearerAuth()
@Controller('system')
export class SystemController {
  constructor(
    private ds: DataSource,
    private cache: CacheService,
    private jobs: JobQueueService,
    private scheduler: SchedulerRegistry,
    private audit: AuditService,
    private pdf: PdfService,
  ) {}

  @Get('health')
  @RequirePermissions(P.SYSTEM_HEALTH)
  @ApiOperation({ summary: 'Process, database, slow endpoints & queries, cache, background jobs' })
  async health() {
    const t0 = Date.now();
    const [db] = await this.ds.query(
      `SELECT version() AS version, pg_database_size(current_database())::bigint AS size,
              (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS connections,
              (SELECT round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) FROM pg_stat_database WHERE datname = current_database())::float AS cache_hit,
              (SELECT round(100.0 * sum(idx_scan) / nullif(sum(idx_scan) + sum(seq_scan), 0), 2) FROM pg_stat_user_tables)::float AS index_usage`,
    );
    const dbLatency = Date.now() - t0;
    const tables = await this.ds.query(
      `SELECT relname AS table, n_live_tup::bigint AS rows, pg_total_relation_size(relid)::bigint AS bytes, seq_scan::bigint AS seq_scans, coalesce(idx_scan, 0)::bigint AS idx_scans
         FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 12`,
    );
    const pool = (this.ds.driver as any).master;
    const mem = process.memoryUsage();
    const routes = metrics.routeTable();
    const crons = [...this.scheduler.getCronJobs().entries()].map(([name, job]) => {
      let next: string | null = null;
      try {
        next = job.nextDate().toISO();
      } catch {
        next = null;
      }
      return { name, next, lastRun: (job as any).lastDate?.()?.toISOString?.() ?? null };
    });
    return {
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
        pid: process.pid,
        memoryMb: { rss: mb(mem.rss), heapUsed: mb(mem.heapUsed), heapTotal: mb(mem.heapTotal) },
        eventLoopDelayMs: { p50: Math.round(loop.percentile(50) / 1e6), p99: Math.round(loop.percentile(99) / 1e6), max: Math.round(loop.max / 1e6) },
        host: { cpus: os.cpus().length, load1: Math.round(os.loadavg()[0] * 100) / 100, freeMemMb: mb(os.freemem()), totalMemMb: mb(os.totalmem()) },
      },
      database: {
        latencyMs: dbLatency,
        version: String(db.version).split(' on ')[0],
        sizeMb: mb(Number(db.size)),
        connections: db.connections,
        pool: pool ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: pool.options?.max } : null,
        cacheHitRatio: db.cache_hit,
        indexUsageRatio: db.index_usage,
        tables: tables.map((t: any) => ({ table: t.table, rows: Number(t.rows), sizeMb: mb(Number(t.bytes)), seqScans: Number(t.seq_scans), idxScans: Number(t.idx_scans) })),
      },
      http: {
        since: new Date(metrics.startedAt).toISOString(),
        ...metrics.totals,
        errorRate: metrics.totals.requests ? Math.round((metrics.totals.errors5xx / metrics.totals.requests) * 10000) / 100 : 0,
        slowest: [...routes].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 15),
        busiest: [...routes].sort((a, b) => b.count - a.count).slice(0, 10),
        slowRequests: metrics.slowRequests.slice(0, 20),
      },
      slowQueries: metrics.slowQueries.slice(0, 20),
      cache: this.cache.stats(),
      jobs: { pending: this.jobs.pendingCount(), crons },
      pdf: { available: this.pdf.available },
    };
  }

  @Post('cache/clear')
  @HttpCode(200)
  @RequirePermissions(P.SYSTEM_HEALTH)
  async clearCache(@CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    this.cache.clear();
    await this.audit.log({ userId: u.id, action: 'CACHE_CLEARED', entity: 'system', ...meta });
    return { ok: true };
  }

  @Post('metrics/reset')
  @HttpCode(200)
  @RequirePermissions(P.SYSTEM_HEALTH)
  resetMetrics() {
    metrics.reset();
    return { ok: true };
  }
}
