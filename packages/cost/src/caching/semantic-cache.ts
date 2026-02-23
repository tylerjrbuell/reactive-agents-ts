import { Effect, Ref } from "effect";
import type { CacheEntry } from "../types.js";
import { CacheError } from "../errors.js";

const DEFAULT_TTL_MS = 3_600_000; // 1 hour
const MAX_CACHE_SIZE = 10_000;
const SEMANTIC_SIMILARITY_THRESHOLD = 0.92;

// Extended entry includes optional embedding (in-memory only, not persisted)
type ExtendedCacheEntry = CacheEntry & { readonly embedding?: readonly number[] };

/** Optional function to generate embeddings for semantic similarity matching. */
export type EmbedFn = (texts: readonly string[]) => Effect.Effect<readonly (readonly number[])[], any>;

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface SemanticCache {
  readonly check: (query: string) => Effect.Effect<string | null, CacheError>;
  readonly store: (query: string, response: string, model: string, ttlMs?: number) => Effect.Effect<void, CacheError>;
  readonly getStats: Effect.Effect<{ entries: number; totalHits: number; avgHitsPerEntry: number }, never>;
}

/**
 * Factory for SemanticCache.
 *
 * Tier 1 (default, no embedFn): Exact hash matching only. Fast, zero cost.
 * Tier 2 (with embedFn): Cosine similarity > 0.92 for semantic matching.
 *   Always tries hash match first; if no match and embedFn available,
 *   generates query embedding and finds nearest cached entry above threshold.
 */
export const makeSemanticCache = (embedFn?: EmbedFn) =>
  Effect.gen(function* () {
    const cacheRef = yield* Ref.make<ExtendedCacheEntry[]>([]);

    const check = (query: string): Effect.Effect<string | null, CacheError> =>
      Effect.gen(function* () {
        const key = query.toLowerCase().trim();
        const queryHash = hashString(key);
        const entries = yield* Ref.get(cacheRef);
        const now = Date.now();

        // Fast path: exact hash match
        const hashMatch = entries.find(
          (e) => e.queryHash === queryHash && now - e.createdAt.getTime() < e.ttlMs,
        );
        if (hashMatch) {
          yield* Ref.update(cacheRef, (es) =>
            es.map((e) =>
              e.queryHash === queryHash
                ? { ...e, hitCount: e.hitCount + 1, lastHitAt: new Date() }
                : e,
            ),
          );
          return hashMatch.response;
        }

        // Slow path: embedding-based similarity (Tier 2)
        if (embedFn) {
          const validWithEmbeddings = entries.filter(
            (e) => e.embedding && now - e.createdAt.getTime() < e.ttlMs,
          );
          if (validWithEmbeddings.length > 0) {
            const queryEmbeddings = yield* embedFn([key]).pipe(
              Effect.catchAll(() => Effect.succeed([] as readonly (readonly number[])[])),
            );
            const queryEmbedding = queryEmbeddings[0];
            if (queryEmbedding && queryEmbedding.length > 0) {
              let bestEntry: ExtendedCacheEntry | undefined;
              let bestSim = SEMANTIC_SIMILARITY_THRESHOLD;
              for (const entry of validWithEmbeddings) {
                const sim = cosineSimilarity(queryEmbedding, entry.embedding!);
                if (sim > bestSim) {
                  bestSim = sim;
                  bestEntry = entry;
                }
              }
              if (bestEntry) {
                const matchHash = bestEntry.queryHash;
                yield* Ref.update(cacheRef, (es) =>
                  es.map((e) =>
                    e.queryHash === matchHash
                      ? { ...e, hitCount: e.hitCount + 1, lastHitAt: new Date() }
                      : e,
                  ),
                );
                return bestEntry.response;
              }
            }
          }
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
        const key = query.toLowerCase().trim();
        const queryHash = hashString(key);

        // Generate embedding for future semantic matching
        let embedding: readonly number[] | undefined;
        if (embedFn) {
          const embs = yield* embedFn([key]).pipe(
            Effect.catchAll(() => Effect.succeed([] as readonly (readonly number[])[])),
          );
          embedding = embs[0];
        }

        const entry: ExtendedCacheEntry = {
          queryHash,
          response,
          model,
          createdAt: new Date(),
          hitCount: 0,
          lastHitAt: new Date(),
          ttlMs,
          ...(embedding ? { embedding } : {}),
        };

        yield* Ref.update(cacheRef, (entries) => {
          const now = Date.now();
          const valid = entries.filter(
            (e) => now - e.createdAt.getTime() < e.ttlMs,
          );
          if (valid.length >= MAX_CACHE_SIZE) {
            valid.sort((a, b) => b.lastHitAt.getTime() - a.lastHitAt.getTime());
            valid.pop();
          }
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
