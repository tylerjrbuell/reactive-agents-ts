import { Effect, Ref } from "effect";
import type { CacheEntry } from "../types.js";
import { CacheError } from "../errors.js";

const DEFAULT_TTL_MS = 3_600_000; // 1 hour
const MAX_CACHE_SIZE = 10_000;

export interface SemanticCache {
  readonly check: (query: string) => Effect.Effect<string | null, CacheError>;
  readonly store: (query: string, response: string, model: string, ttlMs?: number) => Effect.Effect<void, CacheError>;
  readonly getStats: Effect.Effect<{ entries: number; totalHits: number; avgHitsPerEntry: number }, never>;
}

/**
 * Tier 1: Hash-based semantic cache (exact match).
 * Tier 2 will upgrade to embedding-based similarity matching.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}

export const makeSemanticCache = Effect.gen(function* () {
  const cacheRef = yield* Ref.make<CacheEntry[]>([]);

  const check = (query: string): Effect.Effect<string | null, CacheError> =>
    Effect.gen(function* () {
      const queryHash = hashString(query.toLowerCase().trim());
      const entries = yield* Ref.get(cacheRef);
      const now = Date.now();

      // Find exact hash match within TTL
      const match = entries.find(
        (e) => e.queryHash === queryHash && now - e.createdAt.getTime() < e.ttlMs,
      );

      if (match) {
        // Update hit count
        yield* Ref.update(cacheRef, (entries) =>
          entries.map((e) =>
            e.queryHash === queryHash
              ? { ...e, hitCount: e.hitCount + 1, lastHitAt: new Date() }
              : e,
          ),
        );
        return match.response;
      }

      return null;
    }).pipe(
      Effect.mapError((e) => new CacheError({ message: "Cache lookup failed", cause: e })),
    );

  const store = (
    query: string,
    response: string,
    model: string,
    ttlMs: number = DEFAULT_TTL_MS,
  ): Effect.Effect<void, CacheError> =>
    Effect.gen(function* () {
      const queryHash = hashString(query.toLowerCase().trim());

      const entry: CacheEntry = {
        queryHash,
        response,
        model,
        createdAt: new Date(),
        hitCount: 0,
        lastHitAt: new Date(),
        ttlMs,
      };

      yield* Ref.update(cacheRef, (entries) => {
        // Evict expired entries
        const now = Date.now();
        const valid = entries.filter(
          (e) => now - e.createdAt.getTime() < e.ttlMs,
        );

        // Evict LRU if at capacity
        if (valid.length >= MAX_CACHE_SIZE) {
          valid.sort((a, b) => b.lastHitAt.getTime() - a.lastHitAt.getTime());
          valid.pop();
        }

        // Replace existing entry with same hash or add new
        const existing = valid.findIndex((e) => e.queryHash === queryHash);
        if (existing >= 0) {
          valid[existing] = entry;
          return valid;
        }

        return [...valid, entry];
      });
    }).pipe(
      Effect.mapError((e) => new CacheError({ message: "Cache store failed", cause: e })),
    );

  const getStats = Effect.gen(function* () {
    const entries = yield* Ref.get(cacheRef);
    const totalHits = entries.reduce((sum, e) => sum + e.hitCount, 0);
    return {
      entries: entries.length,
      totalHits,
      avgHitsPerEntry: entries.length > 0 ? totalHits / entries.length : 0,
    };
  });

  return { check, store, getStats } satisfies SemanticCache;
});
