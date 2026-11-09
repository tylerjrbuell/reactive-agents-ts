import { describe, expect, test } from "bun:test";
import { charsToTokens, splitTokens, summarizeUsage } from "../src/index.js";
import type { TokenUsage } from "../src/index.js";

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
});
