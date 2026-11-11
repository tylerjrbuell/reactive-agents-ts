import { describe, expect, test } from "bun:test";
import { MAX_BARS, barTitle, callThroughput, contextMeterOf, formatTokenCount, splitOfTurn, tokenBars, tokenRangeLabel } from "./chat-token-usage.js";
import type { ChatTurn } from "$lib/stores/chat-store.js";

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

describe("formatTokenCount", () => {
  // Pins the compact rule the token counters and context meter share.
  test("plain below 1000, one decimal k below 10k, whole k from 10k", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(340)).toBe("340");
    expect(formatTokenCount(999.4)).toBe("999");
    expect(formatTokenCount(1000)).toBe("1.0k");
    expect(formatTokenCount(1200)).toBe("1.2k");
    expect(formatTokenCount(9999)).toBe("10.0k");
    expect(formatTokenCount(10_000)).toBe("10k");
    expect(formatTokenCount(123_456)).toBe("123k");
  });

  test("negative input clamps to zero", () => {
    expect(formatTokenCount(-5)).toBe("0");
  });
});

describe("barTitle", () => {
  const bars = tokenBars([{ tokensTotal: 500, tokensIn: 300, tokensOut: 200 }]).bars;
  const bar = bars[0]!;

  test("names the call, its split and the throughput", () => {
    expect(barTitle(bar, { tokensTotal: 500, durationMs: 2000 }, 1)).toBe("call 1: 500 tok (300 in / 200 out) · 250 tok/s");
  });

  test("adds billed and reasoning figures when reported", () => {
    expect(barTitle(bar, { tokensTotal: 500, durationMs: 2000, billedTokens: 400, reasoningTokens: 50 }, 2)).toBe(
      "call 2: 500 tok (300 in / 200 out) · 400 billed · 50 reasoning · 250 tok/s",
    );
  });

  test("omits throughput for a call too short to measure", () => {
    expect(barTitle(bar, { tokensTotal: 500, durationMs: 10 }, 3)).toBe("call 3: 500 tok (300 in / 200 out)");
  });

  test("a zero-total call reads as zero tokens with no split", () => {
    const zero = tokenBars([{ tokensTotal: 0 }]).bars[0]!;
    expect(barTitle(zero, undefined, 4)).toBe("call 4: 0 tok");
  });
});

describe("contextMeterOf", () => {
  const turn = (over: Partial<ChatTurn>): ChatTurn => ({ id: 1, role: "assistant", content: "", tokensUsed: 0, ts: 0, ...over });

  test("an empty session reads as zero with no context and no last reply", () => {
    expect(contextMeterOf([], undefined)).toEqual({
      context: undefined,
      sessionTokens: 0,
      sessionTokensIn: 0,
      sessionTokensOut: 0,
      splitComplete: true,
      sessionInEstimated: false,
      sessionOutEstimated: false,
      streaming: false,
      sessionCost: 0,
      costKnown: true,
      last: undefined,
    });
  });

  test("settled totals pass through without estimation", () => {
    const m = contextMeterOf([], { tokens: 1500, costUsd: 0.02, costKnown: true, tokensIn: 1000, tokensOut: 500, splitComplete: true });
    expect(m.sessionTokens).toBe(1500);
    expect(m.sessionTokensIn).toBe(1000);
    expect(m.sessionTokensOut).toBe(500);
    expect(m.sessionCost).toBe(0.02);
    expect(m.streaming).toBe(false);
  });

  test("a streaming turn adds its live split and keeps per-half estimation flags", () => {
    const streaming = turn({
      id: 2,
      streaming: true,
      tokensUsed: 0,
      liveTokens: 120,
      liveUsage: { tokensIn: 100, tokensOut: 20, estimatedIn: true, estimatedOut: false },
    });
    const m = contextMeterOf([streaming], { tokens: 1500, costUsd: 0, costKnown: true, tokensIn: 1000, tokensOut: 500 });
    expect(m.streaming).toBe(true);
    expect(m.sessionTokensIn).toBe(1100);
    expect(m.sessionTokensOut).toBe(520);
    expect(m.sessionInEstimated).toBe(true);
    expect(m.sessionOutEstimated).toBe(false);
  });

  test("last reply is the newest settled assistant turn, never the streaming one", () => {
    const settled = turn({ id: 1, tokensUsed: 300, tokensIn: 200, tokensOut: 100, steps: 2, toolCalls: [] });
    const live = turn({ id: 2, streaming: true, tokensUsed: 0, liveTokens: 50 });
    expect(contextMeterOf([settled, live], undefined).last).toEqual({
      tokens: 300,
      tokensIn: 200,
      tokensOut: 100,
      steps: 2,
      toolCalls: 0,
    });
  });

  test("the context reading is the newest turn that carries one", () => {
    const ctx = { tokensUsed: 1000, windowTokens: 4000, utilizationPct: 25, level: "low" as const, estimated: false };
    expect(contextMeterOf([turn({ id: 1, context: ctx }), turn({ id: 2 })], undefined).context).toEqual(ctx);
  });
});
