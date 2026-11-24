import { Logger as NestLogger } from '@nestjs/common';
import { AbstractLogger, LogLevel, LogMessage, QueryRunner } from 'typeorm';
import { metrics } from './metrics';

/** TypeORM logger that only reports errors and slow queries (feeds the System health page). */
export class DbMetricsLogger extends AbstractLogger {
  private readonly nest = new NestLogger('SQL');

  protected writeLog(level: LogLevel, message: string | number | LogMessage | (string | number | LogMessage)[]) {
    if (level === 'warn' || level === 'error') this.nest.warn(String(Array.isArray(message) ? message.map((m: any) => m?.message ?? m).join(' ') : (message as any)?.message ?? message));
  }

  logQuerySlow(time: number, query: string, _parameters?: unknown[], _qr?: QueryRunner) {
    metrics.recordSlowQuery(query, time);
    this.nest.warn(`Slow query ${time}ms: ${query.replace(/\s+/g, ' ').slice(0, 200)}`);
  }

  logQueryError(error: string | Error, query: string) {
    this.nest.error(`Query failed: ${typeof error === 'string' ? error : error.message} — ${query.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
}
