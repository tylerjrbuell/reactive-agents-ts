import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { makeSemanticCache, type EmbedFn } from "../src/caching/semantic-cache.js";

const run = <A>(eff: Effect.Effect<A, any>) => Effect.runPromise(eff);

// ─── Deterministic mock embed function ───
// Maps text → a unit vector on a fixed 4-D basis.
// Texts starting with 'a' → [1,0,0,0], 'b' → [0,1,0,0], etc.
// Identical texts → similarity = 1.0; unrelated texts → similarity = 0.

const mockEmbedFn: EmbedFn = (texts) =>
  Effect.succeed(
    texts.map((t) => {
      const key = t.toLowerCase().trim()[0] ?? "z";
      // Deterministic 4-D embedding based on first char bucket
      const buckets: Record<string, readonly number[]> = {
        a: [1, 0, 0, 0],
        b: [0, 1, 0, 0],
        c: [0, 0, 1, 0],
        d: [0, 0, 0, 1],
      };
      return buckets[key] ?? [0.5, 0.5, 0.5, 0.5];
    }),
  );

// High-similarity embedder: all texts map to the same vector → similarity = 1.0
const alwaysSimilarEmbedFn: EmbedFn = (texts) =>
  Effect.succeed(texts.map(() => [0.6, 0.8, 0, 0]));

// Low-similarity embedder: each text gets a unique unrelated vector
let counter = 0;
const alwaysDissimilarEmbedFn: EmbedFn = (texts) =>
  Effect.succeed(
    texts.map(() => {
      const i = counter++ % 4;
      const v = [0, 0, 0, 0] as number[];
      v[i] = 1;
      return v;
    }),
  );

// ─── Phase 2.3: Semantic Cache with Embeddings ───

describe("SemanticCache — Tier 2 (embedding-based)", () => {
  it("returns null when no embedFn and no hash match", async () => {
    const result = await run(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache();
        yield* cache.store("TypeScript is great", "TS answer", "haiku");
        // Different wording, no embedFn → cache miss
        return yield* cache.check("TypeScript is awesome");
      }),
    );
    expect(result).toBeNull();
  });

  it("returns cached response when embeddings are highly similar (>0.92)", async () => {
    const result = await run(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache(alwaysSimilarEmbedFn);
        yield* cache.store("original question", "cached answer", "haiku");
        // Different text but embeddings are identical (sim=1.0 > 0.92)
        return yield* cache.check("paraphrased question");
      }),
    );
    expect(result).toBe("cached answer");
  });

  it("returns null when embeddings are dissimilar (<0.92)", async () => {
    counter = 0; // reset counter
    const result = await run(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache(alwaysDissimilarEmbedFn);
        yield* cache.store("original question", "cached answer", "haiku");
        return yield* cache.check("completely different query");
      }),
    );
    // Different vectors → cosine similarity = 0 < 0.92 → cache miss
    expect(result).toBeNull();
  });

  it("prefers exact hash match over semantic match (fast path)", async () => {
    let embedCallCount = 0;
    const countingEmbedFn: EmbedFn = (texts) => {
      embedCallCount++;
      return alwaysSimilarEmbedFn(texts);
    };
    const result = await run(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache(countingEmbedFn);
        yield* cache.store("exact query", "exact answer", "haiku");
        return yield* cache.check("exact query");
      }),
    );
    expect(result).toBe("exact answer");
    // embedFn called once for store, not for the check (hash matched)
    expect(embedCallCount).toBe(1);
  });

  it("generates and stores embeddings during store()", async () => {
    let embedCallCount = 0;
    const trackingEmbedFn: EmbedFn = (texts) => {
      embedCallCount++;
      return alwaysSimilarEmbedFn(texts);
    };
    await run(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache(trackingEmbedFn);
        yield* cache.store("query 1", "answer 1", "haiku");
        yield* cache.store("query 2", "answer 2", "haiku");
      }),
    );
    // embedFn called once per store
    expect(embedCallCount).toBe(2);
  });

  it("does not call embedFn for check when hash matches", async () => {
    let checkEmbedCalls = 0;
    const trackingEmbedFn: EmbedFn = (texts) => {
      checkEmbedCalls++;
      return mockEmbedFn(texts);
    };
    const result = await run(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache(trackingEmbedFn);
        yield* cache.store("hello world", "response", "haiku");
        checkEmbedCalls = 0; // reset after store
        return yield* cache.check("hello world"); // exact hash match
      }),
    );
    expect(result).toBe("response");
    expect(checkEmbedCalls).toBe(0);
  });

  it("gracefully handles embedFn errors and falls back to hash-only", async () => {
    const failingEmbedFn: EmbedFn = () => Effect.fail(new Error("embed API down"));
    const result = await run(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache(failingEmbedFn);
        yield* cache.store("exact query", "answer", "haiku");
        return yield* cache.check("exact query");
      }),
    );
    // Hash match still works even when embedding fails
    expect(result).toBe("answer");
  });

  it("increments hitCount on semantic match", async () => {
    const result = await run(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache(alwaysSimilarEmbedFn);
        yield* cache.store("original question", "response", "haiku");
        yield* cache.check("paraphrased question"); // semantic hit
        return yield* cache.getStats;
      }),
    );
    expect(result.totalHits).toBe(1);
  });
});
