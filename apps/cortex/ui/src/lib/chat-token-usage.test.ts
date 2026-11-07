import { describe, expect, test } from "bun:test";
import { MAX_BARS, tokenBars, tokenRangeLabel } from "./chat-token-usage.js";

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
