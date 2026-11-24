import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { metrics } from './metrics';

/** Times every HTTP request by route template (`GET /api/doctors/:key`), logs the slow ones. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Perf');
  private readonly slowMs: number;

  constructor(config: ConfigService) {
    this.slowMs = config.get<number>('security.slowRequestMs') ?? 1000;
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { id?: string }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const started = process.hrtime.bigint();
    const done = (status: number) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const route = `${req.method} ${req.baseUrl ?? ''}${req.route?.path ?? req.path}`;
      metrics.recordRequest(route, ms, status, this.slowMs, req.id);
      if (ms >= this.slowMs) this.logger.warn(`Slow request ${route} ${Math.round(ms)}ms [${req.id ?? '-'}]`);
    };
    return next.handle().pipe(
      tap({
        next: () => done(res.statusCode),
        error: (e) => done(typeof e?.getStatus === 'function' ? e.getStatus() : 500),
      }),
    );
  }
}
