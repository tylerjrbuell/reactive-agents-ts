// File: src/embedding-cache.ts
/**
 * Content-hash embedding cache — deduplicates embed() calls per text.
 * Cache is keyed by Bun.hash(text) and avoids re-embedding identical strings.
 */
import { Effect } from "effect";
import type { LLMErrors } from "./errors.js";

const MAX_ENTRIES = 5_000;

export interface EmbeddingCache {
  /** Wrap an embed function with content-hash deduplication. */
  readonly embed: (
    texts: readonly string[],
    model?: string,
  ) => Effect.Effect<readonly (readonly number[])[], LLMErrors>;
  /** Number of cached embeddings. */
  readonly size: () => number;
  /** Clear all cached entries. */
  readonly clear: () => void;
}

/**
 * Create an embedding cache that wraps an underlying embed function.
 * Each text is hashed individually; only cache-misses are sent to the LLM.
 */
export const makeEmbeddingCache = (
  underlying: (
    texts: readonly string[],
    model?: string,
  ) => Effect.Effect<readonly (readonly number[])[], LLMErrors>,
): EmbeddingCache => {
  // Per-model caches to avoid collisions between models with different dimensions
  const caches = new Map<string, Map<string, readonly number[]>>();

  const getModelCache = (model: string): Map<string, readonly number[]> => {
    let c = caches.get(model);
    if (!c) {
      c = new Map();
      caches.set(model, c);
    }
    return c;
  };

  const evictIfNeeded = (cache: Map<string, readonly number[]>) => {
    if (cache.size > MAX_ENTRIES) {
      // Evict oldest 20%
      const evictCount = Math.floor(MAX_ENTRIES * 0.2);
      const keys = cache.keys();
      for (let i = 0; i < evictCount; i++) {
        const next = keys.next();
        if (next.done) break;
        cache.delete(next.value);
      }
    }
  };

  return {
    embed: (texts, model) =>
      Effect.gen(function* () {
        const modelKey = model ?? "__default__";
        const cache = getModelCache(modelKey);

        // Partition into hits and misses
        const results: (readonly number[] | null)[] = new Array(texts.length);
        const misses: { index: number; text: string }[] = [];

        for (let i = 0; i < texts.length; i++) {
          const hash = Bun.hash(texts[i]!).toString(36);
          const cached = cache.get(hash);
          if (cached) {
            results[i] = cached;
          } else {
            results[i] = null;
            misses.push({ index: i, text: texts[i]! });
          }
        }

        // All cached — skip LLM call entirely
        if (misses.length === 0) {
          return results as readonly (readonly number[])[];
        }

        // Call underlying for misses only
        const missTexts = misses.map((m) => m.text);
        const embeddings = yield* underlying(missTexts, model);

        // Store in cache
        for (let j = 0; j < misses.length; j++) {
          const { index, text } = misses[j]!;
          const embedding = embeddings[j]!;
          const hash = Bun.hash(text).toString(36);
          cache.set(hash, embedding);
          results[index] = embedding;
        }

        evictIfNeeded(cache);
        return results as readonly (readonly number[])[];
      }),

    size: () => {
      let total = 0;
      for (const c of caches.values()) total += c.size;
      return total;
    },

    clear: () => caches.clear(),
  };
};
