// Run: bun test packages/llm-provider/tests/cached-input-tokens-are-counted.test.ts
//
// 2026-07-28 — the measurement bug that confounded every token ablation in this
// repo.
//
// Anthropic's `usage.input_tokens` counts only the UNCACHED remainder of the
// prompt; the cached prefix arrives separately as `cache_read_input_tokens` /
// `cache_creation_input_tokens`. Both provider paths reported the remainder as
// `inputTokens` and `totalTokens`, while computing `estimatedCost` off the
// correct total — the call sites re-added the pools locally, so the author had
// clearly seen the issue and fixed it for money only.
//
// Consequence: the better a run cached, the cheaper it APPEARED. Measured on a
// live haiku run, calls carrying ten tool schemas and a full conversation
// reported `in=6` once the cache warmed, against `in=3746` for the same call
// shape cold.
//
// This is not a rounding error, it is a confound, and it inverted a real
// finding. The `disclosure-ablation` arm set read:
//
//   arm         buggy accounting     correct accounting
//   no-prune    17,819t  (+27%)      66,733t  (+376%)
//   prune-only  39,179t (+180%)      39,179t  (+180%)
//
// i.e. lazy tool disclosure looked like it COST 2.2x when it in fact SAVES 41%.
// A conclusion was one commit away from being published off the broken numbers.
//
// RED-ON-CUT: revert `inputTokens` to `usage.input_tokens` in either provider
// path and the first cell fails.
import { describe, it, expect } from "bun:test";
import { totalInputTokens } from "../src/providers/anthropic.js";

describe("cached prompt tokens are counted as input", () => {
  it("includes both cache pools in the prompt size", () => {
    // The shape of a warm cache hit: almost the whole prompt served from cache.
    const usage = {
      input_tokens: 6,
      cache_read_input_tokens: 3700,
      cache_creation_input_tokens: 0,
    };

    // The load-bearing assertion. Reporting 6 here is what made a caching arm
    // read as ~600x cheaper per call than a churning one.
    expect(totalInputTokens(usage)).toBe(3706);
  });

  it("counts cache CREATION too — writing the cache is billed input", () => {
    expect(
      totalInputTokens({
        input_tokens: 12,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 3494,
      }),
    ).toBe(3506);
  });

  it("is unchanged when no caching is in play", () => {
    // Every non-caching provider and every cold call must be byte-identical to
    // the old behaviour, or this 'fix' would silently re-scale historical
    // baselines. Absent fields and explicit zeros both have to work.
    expect(totalInputTokens({ input_tokens: 1405 })).toBe(1405);
    expect(
      totalInputTokens({
        input_tokens: 1405,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      }),
    ).toBe(1405);
  });

  it("treats null cache fields as zero rather than propagating NaN", () => {
    // The SDK types allow null. `undefined ?? 0` is not enough on its own if a
    // caller hands through a null, and a NaN here would poison every downstream
    // token sum silently instead of failing loudly.
    expect(
      totalInputTokens({
        input_tokens: 100,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
      }),
    ).toBe(100);
  });
});
