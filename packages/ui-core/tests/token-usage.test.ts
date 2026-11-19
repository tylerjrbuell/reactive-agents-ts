import { describe, expect, test } from "bun:test";
import { charsToTokens, estimateTokens, splitTokens, summarizeUsage } from "../src/index.js";
import type { TokenUsage } from "../src/index.js";
import { contextLevel } from "../src/state/token-usage.js";

describe("splitTokens", () => {
  test("both halves reported stay unchanged and measured", () => {
    expect(splitTokens(1000, 500, 1500)).toEqual({ tokensIn: 1000, tokensOut: 500, estimated: false });
  });

  test("only input reported derives output from the total", () => {
    expect(splitTokens(1000, undefined, 1500)).toEqual({ tokensIn: 1000, tokensOut: 500, estimated: true });
  });

  test("only output reported derives input from the total", () => {
    expect(splitTokens(undefined, 500, 1500)).toEqual({ tokensIn: 1000, tokensOut: 500, estimated: true });
  });

  test("neither half reported falls back to 70/30 and says so", () => {
    expect(splitTokens(undefined, undefined, 1000)).toEqual({ tokensIn: 700, tokensOut: 300, estimated: true });
  });

  test("a zero total stays zero", () => {
    expect(splitTokens(undefined, undefined, 0)).toEqual({ tokensIn: 0, tokensOut: 0, estimated: true });
  });
});

describe("charsToTokens", () => {
  test("bounds", () => {
    expect(charsToTokens(0)).toBe(0);
    expect(charsToTokens(1)).toBe(1);
    expect(charsToTokens(5)).toBe(2);
    expect(charsToTokens(-10)).toBe(0);
    expect(charsToTokens(Number.NaN)).toBe(0);
  });
});

const usage = (over: Partial<TokenUsage>): TokenUsage => ({
  _tag: "TokenUsage",
  callId: "c1",
  tokensTotal: 1500,
  tokensIn: 1000,
  tokensOut: 500,
  estimated: false,
  model: "m",
  provider: "p",
  durationMs: 10,
  costUsd: 0.01,
  ...over,
});

describe("summarizeUsage", () => {
  test("first call becomes the only call", () => {
    const u = summarizeUsage(undefined, usage({}));
    expect(u.calls).toHaveLength(1);
    expect(u.tokensTotal).toBe(1500);
    expect(u.estimated).toBe(false);
  });

  test("duplicate callId replaces instead of appending", () => {
    const u = summarizeUsage(summarizeUsage(undefined, usage({})), usage({ tokensTotal: 1700, tokensOut: 700 }));
    expect(u.calls).toHaveLength(1);
    expect(u.tokensTotal).toBe(1700);
  });

  test("billed and reasoning tokens sum, and absent fields add zero", () => {
    const u = summarizeUsage(
      summarizeUsage(undefined, usage({ callId: "a", billedTokens: 700, reasoningTokens: 120 })),
      usage({ callId: "b", billedTokens: 300 }),
    );
    expect(u.billedTokens).toBe(1000);
    expect(u.reasoningTokens).toBe(120);
    expect(summarizeUsage(undefined, usage({})).billedTokens).toBe(0);
    expect(summarizeUsage(undefined, usage({})).reasoningTokens).toBe(0);
  });

  test("cache figures sum, and an absent cache field adds zero", () => {
    const u = summarizeUsage(
      summarizeUsage(undefined, usage({ callId: "a", cacheReadTokensIn: 900, cacheCreationTokensIn: 100 })),
      usage({ callId: "b", cacheReadTokensIn: 300 }),
    );
    expect(u.cacheReadTokensIn).toBe(1200);
    expect(u.cacheCreationTokensIn).toBe(100);
  });

  test("an unknown price adds nothing and marks the cost partial, never NaN", () => {
    const priced = summarizeUsage(undefined, usage({ callId: "a", costUsd: 0.01 }));
    expect(priced.costUsd).toBe(0.01);
    expect(priced.costComplete).toBe(true);

    const u = summarizeUsage(priced, usage({ callId: "b", costUsd: undefined, priceSource: "unknown" }));
    expect(Number.isNaN(u.costUsd)).toBe(false);
    expect(u.costUsd).toBe(0.01);
    expect(u.costComplete).toBe(false);
    expect(u.calls[1]?.costUsd).toBeUndefined();
  });

  test("priceSource unknown wins over a stray costUsd", () => {
    const u = summarizeUsage(undefined, usage({ costUsd: 0, priceSource: "unknown" }));
    expect(u.costUsd).toBe(0);
    expect(u.costComplete).toBe(false);
  });
});

describe("estimateTokens", () => {
  test("empty or whitespace returns zero", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   \n\t")).toBe(0);
  });

  test("never returns less than 1 for non-empty text", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("ab")).toBe(1);
  });

  test("latin prose uses roughly 4 chars per token", () => {
    expect(estimateTokens("a".repeat(40))).toBe(10);
  });

  test("CJK text uses roughly 1.5 chars per token", () => {
    expect(estimateTokens("漢".repeat(12))).toBe(8);
  });

  test("mixed text sums per-script estimates", () => {
    expect(estimateTokens("漢".repeat(12) + "a".repeat(40))).toBe(18);
  });

  test("other scripts use a conservative intermediate ratio", () => {
    expect(estimateTokens("😀".repeat(6))).toBe(2);
  });

  test("charsToTokens stays the latin baseline for backward compatibility", () => {
    expect(charsToTokens(40)).toBe(10);
    expect(charsToTokens(0)).toBe(0);
  });
});

describe("contextLevel", () => {
  // Pins the runtime context-pressure thresholds (45 / 75 / 90) in one place.
  // Every copy of the ladder (chat-stream, context gauges) must agree with this.
  test("boundaries: 44 low, 45 medium, 74 medium, 75 high, 89 high, 90 critical", () => {
    expect(contextLevel(0)).toBe("low");
    expect(contextLevel(44)).toBe("low");
    expect(contextLevel(45)).toBe("medium");
    expect(contextLevel(74)).toBe("medium");
    expect(contextLevel(75)).toBe("high");
    expect(contextLevel(89)).toBe("high");
    expect(contextLevel(90)).toBe("critical");
    expect(contextLevel(100)).toBe("critical");
  });

  test("values above 100 stay critical; negatives stay low", () => {
    expect(contextLevel(140)).toBe("critical");
    expect(contextLevel(-5)).toBe("low");
  });
});
