import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";

import {
  ToolResultCache,
  ToolResultCacheLive,
} from "../src/caching/tool-result-cache.js";

// ── Helper: run effect with cache layer ──────────────────────────────────────

const runWithCache = <A, E>(
  effect: Effect.Effect<A, E, ToolResultCache>,
  config?: Parameters<typeof ToolResultCacheLive>[0],
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(ToolResultCacheLive(config))),
  );

describe("ToolResultCache", () => {
  it("returns null on cache miss", async () => {
    const result = await runWithCache(
      Effect.gen(function* () {
        const cache = yield* ToolResultCache;
        return yield* cache.check("web-search", { query: "hello" });
      }),
    );
    expect(result).toBeNull();
  });

  it("stores and retrieves a cached result", async () => {
    const result = await runWithCache(
      Effect.gen(function* () {
        const cache = yield* ToolResultCache;
        yield* cache.store("web-search", { query: "hello" }, { results: ["a"] }, true);
        return yield* cache.check("web-search", { query: "hello" });
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.result).toEqual({ results: ["a"] });
    expect(result!.success).toBe(true);
  });

  it("returns null for different args (cache miss)", async () => {
    const result = await runWithCache(
      Effect.gen(function* () {
        const cache = yield* ToolResultCache;
        yield* cache.store("web-search", { query: "hello" }, "r1", true);
        return yield* cache.check("web-search", { query: "world" });
      }),
    );
    expect(result).toBeNull();
  });

  it("respects key order normalization (sorted args)", async () => {
    const result = await runWithCache(
      Effect.gen(function* () {
        const cache = yield* ToolResultCache;
        yield* cache.store("http-get", { url: "http://x", timeout: 5 }, "data", true);
        // Check with reversed arg order — should still hit
        return yield* cache.check("http-get", { timeout: 5, url: "http://x" });
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.result).toBe("data");
  });

  it("never caches uncacheable tools (default list)", async () => {
    const result = await runWithCache(
      Effect.gen(function* () {
        const cache = yield* ToolResultCache;
        yield* cache.store("file-write", { path: "/tmp/x" }, "ok", true);
        return yield* cache.check("file-write", { path: "/tmp/x" });
      }),
    );
    expect(result).toBeNull();
  });

  it("never caches custom uncacheable tools", async () => {
    const result = await runWithCache(
      Effect.gen(function* () {
        const cache = yield* ToolResultCache;
        yield* cache.store("dangerous-tool", { x: 1 }, "ok", true);
        return yield* cache.check("dangerous-tool", { x: 1 });
      }),
      { uncacheableTools: ["dangerous-tool"] },
    );
    expect(result).toBeNull();
  });

  it("expires entries after TTL", async () => {
    const result = await runWithCache(
      Effect.gen(function* () {
        const cache = yield* ToolResultCache;
        yield* cache.store("web-search", { q: "a" }, "old", true, 1); // 1ms TTL
        yield* Effect.sleep("10 millis");
        return yield* cache.check("web-search", { q: "a" });
      }),
    );
    expect(result).toBeNull();
  });

  it("invalidates a specific tool+args entry", async () => {
    const result = await runWithCache(
      Effect.gen(function* () {
        const cache = yield* ToolResultCache;
        yield* cache.store("web-search", { q: "a" }, "r1", true);
        yield* cache.store("web-search", { q: "b" }, "r2", true);
        yield* cache.invalidate("web-search", { q: "a" });
        const a = yield* cache.check("web-search", { q: "a" });
        const b = yield* cache.check("web-search", { q: "b" });
        return { a, b };
      }),
    );
    expect(result.a).toBeNull();
    expect(result.b).not.toBeNull();
    expect(result.b!.result).toBe("r2");
  });

  it("invalidates all entries for a tool name", async () => {
    const result = await runWithCache(
      Effect.gen(function* () {
        const cache = yield* ToolResultCache;
        yield* cache.store("web-search", { q: "a" }, "r1", true);
        yield* cache.store("web-search", { q: "b" }, "r2", true);
        yield* cache.store("http-get", { url: "x" }, "r3", true);
        yield* cache.invalidate("web-search"); // wipe all web-search
        const a = yield* cache.check("web-search", { q: "a" });
        const b = yield* cache.check("web-search", { q: "b" });
        const c = yield* cache.check("http-get", { url: "x" });
        return { a, b, c };
      }),
    );
    expect(result.a).toBeNull();
    expect(result.b).toBeNull();
    expect(result.c).not.toBeNull();
  });

  it("tracks hit/miss stats", async () => {
    const stats = await runWithCache(
      Effect.gen(function* () {
        const cache = yield* ToolResultCache;
        yield* cache.store("web-search", { q: "a" }, "r1", true);
        yield* cache.check("web-search", { q: "a" }); // hit
        yield* cache.check("web-search", { q: "a" }); // hit
        yield* cache.check("web-search", { q: "b" }); // miss
        return yield* cache.getStats();
      }),
    );
    expect(stats.totalHits).toBe(2);
    expect(stats.totalMisses).toBe(1);
    expect(stats.entries).toBe(1);
  });

  it("evicts oldest entry when maxEntries is reached", async () => {
    const result = await runWithCache(
      Effect.gen(function* () {
        const cache = yield* ToolResultCache;
        yield* cache.store("t", { i: 1 }, "first", true);
        yield* Effect.sleep("5 millis"); // ensure different timestamps
        yield* cache.store("t", { i: 2 }, "second", true);
        yield* Effect.sleep("5 millis");
        yield* cache.store("t", { i: 3 }, "third", true); // evicts { i: 1 }
        const first = yield* cache.check("t", { i: 1 });
        const second = yield* cache.check("t", { i: 2 });
        const third = yield* cache.check("t", { i: 3 });
        return { first, second, third };
      }),
      { maxEntries: 2 },
    );
    expect(result.first).toBeNull(); // evicted
    expect(result.second).not.toBeNull();
    expect(result.third).not.toBeNull();
  });

  it("caches failed results too (success: false)", async () => {
    const result = await runWithCache(
      Effect.gen(function* () {
        const cache = yield* ToolResultCache;
        yield* cache.store("web-search", { q: "bad" }, "error msg", false);
        return yield* cache.check("web-search", { q: "bad" });
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.result).toBe("error msg");
  });
});
