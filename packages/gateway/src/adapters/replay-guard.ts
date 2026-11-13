/** Default signed-timestamp tolerance for webhook replay protection: 5 minutes. */
export const DEFAULT_REPLAY_WINDOW_MS = 300_000;

/** Most distinct deliveries one guard remembers; the oldest is evicted first. */
export const REPLAY_GUARD_MAX_ENTRIES = 4096;

/**
 * Parse an `x-webhook-timestamp` style header: epoch seconds or epoch milliseconds, digits only.
 * Returns `undefined` for anything else.
 */
export const parseTimestampMs = (raw: string): number | undefined => {
  if (!/^\d{1,16}$/.test(raw.trim())) return undefined;
  const n = Number(raw);
  return n < 1e12 ? n * 1000 : n;
};

/**
 * Bounded TTL cache of delivery keys. `firstSeen(key, nowMs)` returns true the first time a key is
 * seen inside `ttlMs` and false for a repeat. Call it only AFTER the signature verified, otherwise an
 * unauthenticated sender could fill the cache. Insertion order doubles as age order, so eviction and
 * expiry both pop from the front.
 */
export const makeReplayGuard = (
  ttlMs: number,
  maxEntries: number = REPLAY_GUARD_MAX_ENTRIES,
): ((key: string, nowMs: number) => boolean) => {
  const seen = new Map<string, number>();
  return (key, nowMs) => {
    for (const [k, expiresAt] of seen) {
      if (expiresAt > nowMs) break;
      seen.delete(k);
    }
    if (seen.has(key)) return false;
    seen.set(key, nowMs + ttlMs);
    if (seen.size > maxEntries) {
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  };
};
