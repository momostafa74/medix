/**
 * Process-local request & query metrics (no external dependency). Kept small on purpose:
 * per-route counters + a ring of recent durations for percentiles, and the last slow events.
 */
export interface RouteStat {
  route: string;
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  recent: number[];
}

const RING = 300;

export function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}

class Metrics {
  readonly startedAt = Date.now();
  routes = new Map<string, RouteStat>();
  slowRequests: { route: string; ms: number; status: number; at: string; requestId?: string }[] = [];
  slowQueries: { query: string; ms: number; at: string }[] = [];
  totals = { requests: 0, errors5xx: 0, errors4xx: 0 };

  recordRequest(route: string, ms: number, status: number, slowMs: number, requestId?: string) {
    this.totals.requests++;
    if (status >= 500) this.totals.errors5xx++;
    else if (status >= 400) this.totals.errors4xx++;
    let r = this.routes.get(route);
    if (!r) {
      r = { route, count: 0, errors: 0, totalMs: 0, maxMs: 0, recent: [] };
      this.routes.set(route, r);
    }
    r.count++;
    if (status >= 500) r.errors++;
    r.totalMs += ms;
    r.maxMs = Math.max(r.maxMs, ms);
    r.recent.push(ms);
    if (r.recent.length > RING) r.recent.shift();
    if (ms >= slowMs) {
      this.slowRequests.unshift({ route, ms: Math.round(ms), status, at: new Date().toISOString(), requestId });
      this.slowRequests.length = Math.min(this.slowRequests.length, 50);
    }
  }

  recordSlowQuery(query: string, ms: number) {
    // Only the statement shape — parameters (which may hold personal data) are never kept.
    this.slowQueries.unshift({ query: query.replace(/\s+/g, ' ').slice(0, 400), ms: Math.round(ms), at: new Date().toISOString() });
    this.slowQueries.length = Math.min(this.slowQueries.length, 50);
  }

  routeTable() {
    return [...this.routes.values()].map((r) => ({
      route: r.route,
      count: r.count,
      errors: r.errors,
      avgMs: Math.round(r.totalMs / r.count),
      p50Ms: Math.round(percentile(r.recent, 50)),
      p95Ms: Math.round(percentile(r.recent, 95)),
      maxMs: Math.round(r.maxMs),
    }));
  }

  reset() {
    this.routes.clear();
    this.slowRequests = [];
    this.slowQueries = [];
    this.totals = { requests: 0, errors5xx: 0, errors4xx: 0 };
  }
}

/** Singleton shared by the HTTP interceptor and the TypeORM logger (which is created outside DI). */
export const metrics = new Metrics();
