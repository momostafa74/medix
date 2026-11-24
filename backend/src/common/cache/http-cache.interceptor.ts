import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { from, Observable, of, tap } from 'rxjs';
import { CacheService } from './cache.service';

const CACHE_PUBLIC = 'medix:cachePublic';
const INVALIDATES = 'medix:invalidates';

/**
 * Caches a PUBLIC GET response (same for every visitor) in memory for `seconds` and tells
 * browsers/CDNs they may keep it too. Express adds an ETag, so repeat visits get 304.
 */
export const CachePublic = (seconds: number, tag: string) => SetMetadata(CACHE_PUBLIC, { seconds, tag });
/** After a successful write, drops cached responses with these tags. */
export const InvalidatesCache = (...tags: string[]) => SetMetadata(INVALIDATES, tags);

@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    private cache: CacheService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const invalidates = this.reflector.getAllAndOverride<string[]>(INVALIDATES, targets);
    if (invalidates?.length) return next.handle().pipe(tap(() => this.cache.invalidate(...invalidates)));

    const cfg = this.reflector.getAllAndOverride<{ seconds: number; tag: string }>(CACHE_PUBLIC, targets);
    if (!cfg || req.method !== 'GET') return next.handle();
    res.setHeader('Cache-Control', `public, max-age=${cfg.seconds}, stale-while-revalidate=${cfg.seconds * 5}`);
    const key = `http:${req.originalUrl}`;
    const hit = this.cache.get(key);
    this.cache.record(hit !== undefined);
    if (hit !== undefined) {
      res.setHeader('X-Cache', 'HIT');
      return of(hit);
    }
    res.setHeader('X-Cache', 'MISS');
    return from(
      new Promise((resolve, reject) =>
        next
          .handle()
          .subscribe({
            next: (body) => {
              this.cache.set(key, body, cfg.seconds * 1000, [cfg.tag]);
              resolve(body);
            },
            error: reject,
          }),
      ),
    );
  }
}
