import { describe, expect, it } from "bun:test";
import { billedInputTokens } from "../src/billed-tokens.js";

describe("billedInputTokens", () => {
  it("subtracts cache reads from input tokens", () => {
    const r = billedInputTokens({
      inputTokens: 10_000,
      outputTokens: 500,
      cacheReadInputTokens: 9_000,
    });
    expect(r.billedInput).toBe(1_000);
    expect(r.cacheRead).toBe(9_000);
    expect(r.output).toBe(500);
    expect(r.billedTotal).toBe(1_500);
  });

  it("falls back to raw input when the provider reports no cache figures", () => {
    const r = billedInputTokens({ inputTokens: 10_000, outputTokens: 500 });
    expect(r.billedInput).toBe(10_000);
    expect(r.cacheRead).toBe(0);
    expect(r.billedTotal).toBe(10_500);
  });

  it("clamps at zero when a provider reports cacheRead >= input", () => {
    // NOT reachable via this repo's Anthropic path: `totalInputTokens()`
    // (providers/anthropic.ts) reports input_tokens INCLUSIVE of the cache
    // pools since `2f97ca1e`, so `inputTokens - cacheRead` cannot go negative
    // there. This pins the general defense: a hypothetical provider reporting
    // inputTokens EXCLUSIVE of cache, while still reporting cacheRead
    // separately, would make the naive subtraction negative. Billed tokens are
    // never negative.
    const r = billedInputTokens({
      inputTokens: 200,
      outputTokens: 50,
      cacheReadInputTokens: 9_000,
    });
    expect(r.billedInput).toBe(0);
    expect(r.cacheRead).toBe(9_000);
    expect(r.billedTotal).toBe(50);
  });

  it("treats missing fields as zero rather than NaN", () => {
    const r = billedInputTokens({});
    expect(r.billedInput).toBe(0);
    expect(r.output).toBe(0);
    expect(r.billedTotal).toBe(0);
  });
});
