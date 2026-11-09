import { describe, expect, test } from "bun:test";
import { MAX_BARS, callThroughput, splitOfTurn, tokenBars, tokenRangeLabel } from "./chat-token-usage.js";

describe("tokenBars", () => {
  test("two calls: widths proportional, segments split by in/out", () => {
    const r = tokenBars([
      { tokensTotal: 1500, tokensIn: 1000, tokensOut: 500 },
      { tokensTotal: 500, tokensIn: 400, tokensOut: 100 },
    ]);
    expect(r.bars).toHaveLength(2);
    expect(r.overflow).toBe(0);
    expect(r.bars[0]!.width).toBe(1);
    expect(r.bars[1]!.width).toBeCloseTo(500 / 1500, 5);
    expect(r.bars[0]!.inShare).toBeCloseTo(1000 / 1500, 5);
    expect(r.bars[0]!.outShare).toBeCloseTo(500 / 1500, 5);
  });

  test("calls beyond MAX_BARS collapse into overflow (last 24 win)", () => {
    const calls = Array.from({ length: MAX_BARS + 5 }, (_, i) => ({ tokensTotal: 100 + i, tokensIn: 60, tokensOut: 40 }));
    const r = tokenBars(calls);
    expect(r.bars).toHaveLength(MAX_BARS);
    expect(r.overflow).toBe(5);
  });

  test("a zero-total call yields a zero-width bar, not NaN", () => {
    const r = tokenBars([{ tokensTotal: 0, tokensIn: 0, tokensOut: 0 }]);
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0]!.width).toBe(0);
    expect(Number.isNaN(r.bars[0]!.width)).toBe(false);
    expect(Number.isNaN(r.bars[0]!.inShare)).toBe(false);
  });
});

describe("tokenRangeLabel", () => {
  test("formats and prefixes ~ when estimated", () => {
    expect(tokenRangeLabel({ tokensIn: 1200, tokensOut: 340, estimated: false })).toBe("1.2k in · 340 out");
    expect(tokenRangeLabel({ tokensIn: 1200, tokensOut: 340, estimated: true })).toBe("~1.2k in · 340 out");
  });
});

describe("splitOfTurn", () => {
  test("streaming live split wins, with per-half estimation flags", () => {
    const split = splitOfTurn({
      streaming: true,
      tokensUsed: 0,
      liveUsage: { tokensIn: 1000, tokensOut: 42, estimatedIn: false, estimatedOut: true },
    });
    expect(split).toEqual({ tokensIn: 1000, tokensOut: 42, estimatedIn: false, estimatedOut: true });
  });

  test("finished provider split is measured", () => {
    const split = splitOfTurn({ tokensUsed: 1500, tokensIn: 1000, tokensOut: 500 });
    expect(split).toEqual({ tokensIn: 1000, tokensOut: 500, estimatedIn: false, estimatedOut: false });
  });

  test("folded usage fills a split when the reply has none", () => {
    const split = splitOfTurn({
      tokensUsed: 400,
      usage: {
        calls: [{ callId: "a", tokensTotal: 400, tokensIn: 300, tokensOut: 100, estimated: false, model: "m", provider: "p", durationMs: 1, costUsd: 0 }],
        tokensIn: 300,
        tokensOut: 100,
        tokensTotal: 400,
        estimated: false,
        costUsd: 0,
        cacheReadTokensIn: 0,
        cacheCreationTokensIn: 0,
        billedTokens: 0,
        reasoningTokens: 0,
      },
    });
    expect(split).toEqual({ tokensIn: 300, tokensOut: 100, estimatedIn: false, estimatedOut: false });
  });

  test("total-only turns still split, marked estimated on both halves", () => {
    const split = splitOfTurn({ tokensUsed: 400 });
    expect(split.tokensIn + split.tokensOut).toBe(400);
    expect(split.estimatedIn).toBe(true);
    expect(split.estimatedOut).toBe(true);
  });
});

describe("callThroughput", () => {
  test("returns tokens per second when the call took long enough", () => {
    expect(callThroughput({ tokensTotal: 500, durationMs: 2000 })).toBe(250);
  });

  test("returns undefined for a zero-duration call", () => {
    expect(callThroughput({ tokensTotal: 500, durationMs: 0 })).toBeUndefined();
  });

  test("returns undefined for a too-short call", () => {
    expect(callThroughput({ tokensTotal: 500, durationMs: 10 })).toBeUndefined();
  });

  test("returns undefined when tokens are missing", () => {
    expect(callThroughput({ tokensTotal: 0, durationMs: 2000 })).toBeUndefined();
  });

  test("returns undefined for undefined inputs", () => {
    expect(callThroughput({ tokensTotal: undefined as unknown as number, durationMs: 2000 })).toBeUndefined();
  });
});
