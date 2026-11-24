/** Small pure helpers for account security (unit-tested). */

/** Human label for a User-Agent, e.g. "Chrome على Windows" / "Safari على iPhone". */
export function describeDevice(ua?: string | null): string {
  if (!ua) return 'جهاز غير معروف';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : /okhttp|Dart|axios|curl|node|python|Go-http|Java\//i.test(ua)
                ? 'تطبيق'
                : null;
  if (browser && os) return `${browser} على ${os}`;
  return browser || os || 'جهاز غير معروف';
}

/**
 * Device fingerprint used for "new device" alerts: browser family + OS (+ major version
 * changes are ignored on purpose so routine browser updates do not alert).
 */
export const deviceKey = (ua?: string | null) => describeDevice(ua);

/** Minutes left on a lock (rounded up), or 0 when not locked. */
export function lockMinutesLeft(lockedUntil: Date | string | null | undefined, now = Date.now()) {
  if (!lockedUntil) return 0;
  const ms = new Date(lockedUntil).getTime() - now;
  return ms > 0 ? Math.ceil(ms / 60_000) : 0;
}
