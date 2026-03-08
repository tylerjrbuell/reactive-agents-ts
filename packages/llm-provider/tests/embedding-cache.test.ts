// File: tests/embedding-cache.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { makeEmbeddingCache } from "../src/embedding-cache.js";

const fakeEmbed = (calls: string[][]) =>
  (texts: readonly string[], _model?: string) =>
    Effect.sync(() => {
      calls.push([...texts]);
      return texts.map((t) => [t.length, t.charCodeAt(0), 0.5]) as readonly (readonly number[])[];
    });

describe("EmbeddingCache", () => {
  it("passes through on first call", async () => {
    const calls: string[][] = [];
    const cache = makeEmbeddingCache(fakeEmbed(calls));

    const result = await Effect.runPromise(cache.embed(["hello", "world"]));
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(["hello", "world"]);
    expect(result.length).toBe(2);
  });

  it("returns cached embeddings for identical texts", async () => {
    const calls: string[][] = [];
    const cache = makeEmbeddingCache(fakeEmbed(calls));

    await Effect.runPromise(cache.embed(["hello"]));
    const result = await Effect.runPromise(cache.embed(["hello"]));

    // Should not call underlying on second request
    expect(calls.length).toBe(1);
    expect(result.length).toBe(1);
    expect(result[0]![0]).toBe(5); // "hello".length
  });

  it("only sends cache misses to underlying", async () => {
    const calls: string[][] = [];
    const cache = makeEmbeddingCache(fakeEmbed(calls));

    await Effect.runPromise(cache.embed(["hello"]));
    await Effect.runPromise(cache.embed(["hello", "world"]));

    // Second call should only embed "world" (new)
    expect(calls.length).toBe(2);
    expect(calls[1]).toEqual(["world"]);
  });

  it("tracks cache size", async () => {
    const calls: string[][] = [];
    const cache = makeEmbeddingCache(fakeEmbed(calls));

    expect(cache.size()).toBe(0);
    await Effect.runPromise(cache.embed(["a", "b", "c"]));
    expect(cache.size()).toBe(3);
  });

  it("separates caches by model", async () => {
    const calls: string[][] = [];
    const cache = makeEmbeddingCache(fakeEmbed(calls));

    await Effect.runPromise(cache.embed(["hello"], "model-a"));
    await Effect.runPromise(cache.embed(["hello"], "model-b"));

    // Different models → both should call underlying
    expect(calls.length).toBe(2);
    expect(cache.size()).toBe(2);
  });

  it("clear() empties all caches", async () => {
    const calls: string[][] = [];
    const cache = makeEmbeddingCache(fakeEmbed(calls));

    await Effect.runPromise(cache.embed(["hello"]));
    expect(cache.size()).toBe(1);
    cache.clear();
    expect(cache.size()).toBe(0);

    // After clear, should call underlying again
    await Effect.runPromise(cache.embed(["hello"]));
    expect(calls.length).toBe(2);
  });

  it("skips LLM call entirely when all texts are cached", async () => {
    const calls: string[][] = [];
    const cache = makeEmbeddingCache(fakeEmbed(calls));

    await Effect.runPromise(cache.embed(["a", "b"]));
    await Effect.runPromise(cache.embed(["a", "b"]));

    // Only 1 underlying call total
    expect(calls.length).toBe(1);
  });
});
