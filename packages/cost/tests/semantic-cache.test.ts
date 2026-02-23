import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { makeSemanticCache } from "../src/caching/semantic-cache.js";

const runCache = <A>(effect: Effect.Effect<A, any>) =>
  Effect.runPromise(effect);

describe("SemanticCache", () => {
  it("should return null on empty cache", async () => {
    const result = await runCache(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache;
        return yield* cache.check("What is TypeScript?");
      }),
    );
    expect(result).toBeNull();
  });

  it("should return cached response on exact match", async () => {
    const result = await runCache(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache;
        yield* cache.store("What is TypeScript?", "A typed superset of JavaScript.", "haiku");
        return yield* cache.check("What is TypeScript?");
      }),
    );
    expect(result).toBe("A typed superset of JavaScript.");
  });

  it("should match case-insensitively", async () => {
    const result = await runCache(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache;
        yield* cache.store("What is TypeScript?", "A typed JS superset.", "haiku");
        return yield* cache.check("what is typescript?");
      }),
    );
    expect(result).toBe("A typed JS superset.");
  });

  it("should match with leading/trailing whitespace trimmed", async () => {
    const result = await runCache(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache;
        yield* cache.store("  hello world  ", "greeting response", "haiku");
        return yield* cache.check("hello world");
      }),
    );
    expect(result).toBe("greeting response");
  });

  it("should return null on dissimilar queries (cache miss)", async () => {
    const result = await runCache(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache;
        yield* cache.store("What is TypeScript?", "A typed superset of JavaScript.", "haiku");
        return yield* cache.check("How does Rust handle memory safety?");
      }),
    );
    expect(result).toBeNull();
  });

  it("should invalidate entries after TTL expires", async () => {
    const result = await runCache(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache;
        // Store with 1ms TTL so it expires immediately
        yield* cache.store("What is TypeScript?", "A typed superset.", "haiku", 1);
        // Wait for expiration
        yield* Effect.promise(() => new Promise((r) => setTimeout(r, 10)));
        return yield* cache.check("What is TypeScript?");
      }),
    );
    expect(result).toBeNull();
  });

  it("should track cache stats with zero entries initially", async () => {
    const stats = await runCache(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache;
        return yield* cache.getStats;
      }),
    );
    expect(stats.entries).toBe(0);
    expect(stats.totalHits).toBe(0);
    expect(stats.avgHitsPerEntry).toBe(0);
  });

  it("should track cache stats after stores and hits", async () => {
    const stats = await runCache(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache;
        yield* cache.store("q1", "r1", "haiku");
        yield* cache.store("q2", "r2", "sonnet");
        // Hit q1 twice
        yield* cache.check("q1");
        yield* cache.check("q1");
        // Hit q2 once
        yield* cache.check("q2");
        return yield* cache.getStats;
      }),
    );
    expect(stats.entries).toBe(2);
    expect(stats.totalHits).toBe(3);
    expect(stats.avgHitsPerEntry).toBeCloseTo(1.5);
  });

  it("should replace existing entry with same hash on re-store", async () => {
    const result = await runCache(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache;
        yield* cache.store("What is JS?", "Old answer", "haiku");
        yield* cache.store("What is JS?", "Updated answer", "sonnet");
        return yield* cache.check("What is JS?");
      }),
    );
    expect(result).toBe("Updated answer");
  });

  it("should evict expired entries during store", async () => {
    const stats = await runCache(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache;
        // Store with tiny TTL
        yield* cache.store("expiring", "gone soon", "haiku", 1);
        yield* Effect.promise(() => new Promise((r) => setTimeout(r, 10)));
        // Store another entry — should evict the expired one
        yield* cache.store("fresh", "still here", "haiku");
        return yield* cache.getStats;
      }),
    );
    expect(stats.entries).toBe(1);
  });

  it("should increment hitCount on repeated checks", async () => {
    const stats = await runCache(
      Effect.gen(function* () {
        const cache = yield* makeSemanticCache;
        yield* cache.store("q", "r", "haiku");
        yield* cache.check("q");
        yield* cache.check("q");
        yield* cache.check("q");
        return yield* cache.getStats;
      }),
    );
    expect(stats.totalHits).toBe(3);
  });
});
