import { Global, Injectable, Module } from '@nestjs/common';

interface Entry {
  value: unknown;
  expires: number;
  tags: string[];
}

/**
 * In-process cache with TTL, tag invalidation, LRU eviction and single-flight loading
 * (concurrent misses for the same key share one database query).
 *
 * Runs inside each API process — fine for one instance or a few behind a load balancer
 * because every entry is short-lived and writes invalidate their tags. For many instances,
 * swap this class for a Redis-backed one with the same `wrap` / `invalidate` API.
 */
@Injectable()
export class CacheService {
  private store = new Map<string, Entry>();
  private inflight = new Map<string, Promise<unknown>>();
  private hits = 0;
  private misses = 0;
  private readonly maxEntries = 2000;
  /** Tests and `CACHE_DISABLED=true` bypass the cache entirely. */
  private readonly disabled = process.env.CACHE_DISABLED === 'true';

  get<T>(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh LRU position.
    this.store.delete(key);
    this.store.set(key, e);
    return e.value as T;
  }

  set(key: string, value: unknown, ttlMs: number, tags: string[] = []) {
    if (this.disabled) return;
    this.store.set(key, { value, expires: Date.now() + ttlMs, tags });
    while (this.store.size > this.maxEntries) this.store.delete(this.store.keys().next().value as string);
  }

  async wrap<T>(key: string, ttlMs: number, load: () => Promise<T>, tags: string[] = []): Promise<T> {
    if (this.disabled) return load();
    const hit = this.get<T>(key);
    if (hit !== undefined) {
      this.hits++;
      return hit;
    }
    this.misses++;
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;
    const p = load()
      .then((v) => {
        this.set(key, v, ttlMs, tags);
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Hit/miss accounting for callers that use get/set directly (HTTP response cache). */
  record(hit: boolean) {
    if (hit) this.hits++;
    else this.misses++;
  }

  /** Drops every entry carrying one of the tags (call after writes). */
  invalidate(...tags: string[]) {
    for (const [k, e] of this.store) if (e.tags.some((t) => tags.includes(t))) this.store.delete(k);
  }

  clear() {
    this.store.clear();
  }

  stats() {
    const total = this.hits + this.misses;
    return { entries: this.store.size, hits: this.hits, misses: this.misses, hitRate: total ? Math.round((this.hits / total) * 1000) / 10 : 0, disabled: this.disabled };
  }
}

@Global()
@Module({ providers: [CacheService], exports: [CacheService] })
export class CacheModule {}
