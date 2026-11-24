import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';

/** Attaches a request id (echoed in X-Request-Id and error bodies) and logs each request. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: any, res: any, next: () => void) {
    const incoming = req.headers['x-request-id'];
    req.id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms [${req.id}]`;
      if (res.statusCode >= 500) this.logger.error(line);
      else if (process.env.NODE_ENV !== 'test') this.logger.log(line);
    });
    next();
  }
}
