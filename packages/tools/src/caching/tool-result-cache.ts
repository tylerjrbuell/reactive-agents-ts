/**
 * Tool result cache — in-memory LRU-like cache for deterministic tool outputs.
 *
 * Caches results keyed by `toolName + args hash`. Side-effecting tools
 * (file-write, code-execute, recall, etc.) are excluded by default.
 * TTL-based expiration with configurable defaults.
 */
import { Effect, Ref, Context, Layer } from "effect";

// ── Types ────────────────────────────────────────────────────────────────────

/** Configuration for tool result caching. */
export interface ToolResultCacheConfig {
  /** Default TTL in milliseconds (default: 300_000 = 5 minutes) */
  readonly defaultTtlMs?: number;
  /** Maximum number of cached entries before eviction (default: 500) */
  readonly maxEntries?: number;
  /** Tool names that must never be cached (side-effecting tools) */
  readonly uncacheableTools?: readonly string[];
}

interface CacheEntry {
  readonly toolName: string;
  readonly argsKey: string;
  readonly result: unknown;
  readonly success: boolean;
  readonly createdAt: number;
  readonly ttlMs: number;
  hitCount: number;
}

/** Cache statistics for observability. */
export interface ToolCacheStats {
  readonly entries: number;
  readonly totalHits: number;
  readonly totalMisses: number;
}

// ── Default uncacheable tools (side-effecting) ───────────────────────────────

const DEFAULT_UNCACHEABLE = new Set([
  "file-write",
  "code-execute",
  "recall",
  "send-email",
  "send-message",
]);

// ── Cache key generation ─────────────────────────────────────────────────────

function makeCacheKey(toolName: string, args: Record<string, unknown>): string {
  // Deterministic serialization: sort keys for consistency
  const sortedArgs = JSON.stringify(args, Object.keys(args).sort());
  return `${toolName}::${sortedArgs}`;
}

// ── Service Tag ──────────────────────────────────────────────────────────────

/**
 * Tool result cache service. Check before executing, store after.
 */
export class ToolResultCache extends Context.Tag("ToolResultCache")<
  ToolResultCache,
  {
    /** Check cache for a tool result. Returns the cached result or null. */
    readonly check: (
      toolName: string,
      args: Record<string, unknown>,
    ) => Effect.Effect<{ result: unknown; success: boolean } | null>;
    /** Store a tool result in the cache. */
    readonly store: (
      toolName: string,
      args: Record<string, unknown>,
      result: unknown,
      success: boolean,
      ttlMs?: number,
    ) => Effect.Effect<void>;
    /** Invalidate a specific tool/args combo, or all entries for a tool. */
    readonly invalidate: (
      toolName: string,
      args?: Record<string, unknown>,
    ) => Effect.Effect<void>;
    /** Get cache statistics. */
    readonly getStats: () => Effect.Effect<ToolCacheStats>;
  }
>() {}

// ── Live implementation ──────────────────────────────────────────────────────

/**
 * Create a ToolResultCache layer backed by an in-memory Ref.
 */
export const ToolResultCacheLive = (config?: ToolResultCacheConfig) =>
  Layer.effect(
    ToolResultCache,
    Effect.gen(function* () {
      const defaultTtl = config?.defaultTtlMs ?? 300_000;
      const maxEntries = config?.maxEntries ?? 500;
      const uncacheable = new Set([
        ...DEFAULT_UNCACHEABLE,
        ...(config?.uncacheableTools ?? []),
      ]);

      const cacheRef = yield* Ref.make<Map<string, CacheEntry>>(new Map());
      const statsRef = yield* Ref.make({ totalHits: 0, totalMisses: 0 });

      const evictExpired = (cache: Map<string, CacheEntry>) => {
        const now = Date.now();
        for (const [key, entry] of cache) {
          if (now - entry.createdAt > entry.ttlMs) {
            cache.delete(key);
          }
        }
      };

      return ToolResultCache.of({
        check: (toolName, args) =>
          Effect.gen(function* () {
            if (uncacheable.has(toolName)) return null;

            const key = makeCacheKey(toolName, args);
            const cache = yield* Ref.get(cacheRef);
            const entry = cache.get(key);

            if (!entry) {
              yield* Ref.update(statsRef, (s) => ({
                ...s,
                totalMisses: s.totalMisses + 1,
              }));
              return null;
            }

            // Check TTL
            if (Date.now() - entry.createdAt > entry.ttlMs) {
              cache.delete(key);
              yield* Ref.update(statsRef, (s) => ({
                ...s,
                totalMisses: s.totalMisses + 1,
              }));
              return null;
            }

            entry.hitCount++;
            yield* Ref.update(statsRef, (s) => ({
              ...s,
              totalHits: s.totalHits + 1,
            }));
            return { result: entry.result, success: entry.success };
          }),

        store: (toolName, args, result, success, ttlMs) =>
          Effect.gen(function* () {
            if (uncacheable.has(toolName)) return;

            const key = makeCacheKey(toolName, args);
            yield* Ref.update(cacheRef, (cache) => {
              evictExpired(cache);

              // Evict least-recently-used if at capacity
              if (cache.size >= maxEntries) {
                let oldestKey: string | null = null;
                let oldestTime = Infinity;
                for (const [k, v] of cache) {
                  if (v.createdAt < oldestTime) {
                    oldestTime = v.createdAt;
                    oldestKey = k;
                  }
                }
                if (oldestKey) cache.delete(oldestKey);
              }

              cache.set(key, {
                toolName,
                argsKey: key,
                result,
                success,
                createdAt: Date.now(),
                ttlMs: ttlMs ?? defaultTtl,
                hitCount: 0,
              });
              return cache;
            });
          }),

        invalidate: (toolName, args) =>
          Ref.update(cacheRef, (cache) => {
            if (args) {
              cache.delete(makeCacheKey(toolName, args));
            } else {
              // Invalidate all entries for this tool
              for (const [key, entry] of cache) {
                if (entry.toolName === toolName) cache.delete(key);
              }
            }
            return cache;
          }),

        getStats: () =>
          Effect.gen(function* () {
            const cache = yield* Ref.get(cacheRef);
            const stats = yield* Ref.get(statsRef);
            return {
              entries: cache.size,
              totalHits: stats.totalHits,
              totalMisses: stats.totalMisses,
            };
          }),
      });
    }),
  );
