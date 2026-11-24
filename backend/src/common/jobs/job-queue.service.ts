import { Injectable, Logger } from '@nestjs/common';

export type JobHandler<T = any> = (payload: T) => Promise<void>;

/**
 * Background job abstraction. The default implementation runs jobs in-process
 * (setImmediate + retries with backoff) so the app has no Redis dependency.
 * To scale out, replace this provider with a BullMQ-backed class exposing the
 * same `register` / `add` API — callers do not change.
 */
@Injectable()
export class JobQueueService {
  private readonly logger = new Logger('Jobs');
  private handlers = new Map<string, JobHandler>();
  private pending = 0;

  register<T>(name: string, handler: JobHandler<T>) {
    this.handlers.set(name, handler as JobHandler);
  }

  add<T>(name: string, payload: T, opts: { attempts?: number; delayMs?: number } = {}) {
    const handler = this.handlers.get(name);
    if (!handler) {
      this.logger.warn(`No handler registered for job "${name}"`);
      return;
    }
    const attempts = opts.attempts ?? 3;
    const run = async (attempt: number) => {
      this.pending++;
      try {
        await handler(payload);
      } catch (e) {
        if (attempt < attempts) {
          setTimeout(() => run(attempt + 1), 1000 * 2 ** attempt).unref?.();
        } else {
          this.logger.error(`Job "${name}" failed after ${attempts} attempts: ${(e as Error).message}`);
        }
      } finally {
        this.pending--;
      }
    };
    const t = setTimeout(() => run(1), opts.delayMs ?? 0);
    t.unref?.();
  }

  pendingCount() {
    return this.pending;
  }

  /** For tests / graceful shutdown. */
  async drain(timeoutMs = 5000) {
    const start = Date.now();
    while (this.pending > 0 && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 20));
  }
}
