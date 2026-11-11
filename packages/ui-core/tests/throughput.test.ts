import { describe, expect, it } from "bun:test";
import {
  formatFirstToken,
  formatTokensPerSecond,
  liveTokensPerSecond,
  medianOf,
  summarizeUsage,
  throughputOf,
  throughputOfCalls,
} from "../src/index.js";

describe("throughputOf", () => {
  it("measures generation time only when the call reports a first-token time", () => {
    expect(throughputOf({ tokensOut: 100, durationMs: 1500, firstTokenMs: 500 })).toEqual({
      tokensPerSecond: 100,
      firstTokenMs: 500,
      lowerBound: false,
      calls: 1,
    });
  });

  it("is a lower bound over the whole duration without a first-token time", () => {
    expect(throughputOf({ tokensOut: 100, durationMs: 2000 })).toEqual({ tokensPerSecond: 50, lowerBound: true, calls: 1 });
  });

  it("gives no rate without output tokens or with an empty window", () => {
    expect(throughputOf({ durationMs: 2000 })).toBeUndefined();
    expect(throughputOf({ tokensOut: 10, durationMs: 500, firstTokenMs: 500 })).toBeUndefined();
    expect(throughputOf({ tokensOut: 10, durationMs: 0 })).toBeUndefined();
  });
});

describe("throughputOfCalls", () => {
  it("weighs calls by their generation time and averages TTFT over calls that reported it", () => {
    const t = throughputOfCalls([
      { tokensOut: 100, durationMs: 1200, firstTokenMs: 200 }, // 1000 ms window
      { tokensOut: 300, durationMs: 1400, firstTokenMs: 400 }, // 1000 ms window
    ]);
    expect(t).toEqual({ tokensPerSecond: 200, firstTokenMs: 300, lowerBound: false, calls: 2 });
  });

  it("marks the group a lower bound when any call lacked a first-token time", () => {
    const t = throughputOfCalls([
      { tokensOut: 100, durationMs: 1200, firstTokenMs: 200 },
      { tokensOut: 100, durationMs: 1000 },
    ]);
    expect(t?.lowerBound).toBe(true);
    expect(t?.firstTokenMs).toBe(200);
    expect(t?.tokensPerSecond).toBe(100);
  });

  it("skips calls with no rate and returns undefined when none has one", () => {
    expect(throughputOfCalls([{ durationMs: 1000 }])).toBeUndefined();
    expect(throughputOfCalls([])).toBeUndefined();
  });
});

describe("liveTokensPerSecond", () => {
  it("waits for a measurable window", () => {
    expect(liveTokensPerSecond(10, 100)).toBeUndefined();
    expect(liveTokensPerSecond(0, 1000)).toBeUndefined();
    expect(liveTokensPerSecond(50, 1000)).toBe(50);
  });
});

describe("formatting", () => {
  it("formats rates with ~ for estimates", () => {
    expect(formatTokensPerSecond(42.4)).toBe("42 tok/s");
    expect(formatTokensPerSecond(7.46, true)).toBe("~7.5 tok/s");
  });
  it("formats first-token times", () => {
    expect(formatFirstToken(320.4)).toBe("320ms");
    expect(formatFirstToken(1440)).toBe("1.4s");
    expect(formatFirstToken(12_400)).toBe("12s");
  });
});

describe("medianOf", () => {
  it("handles odd, even and empty lists", () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([])).toBeUndefined();
  });
});

describe("summarizeUsage keeps firstTokenMs", () => {
  it("copies the call's first-token time onto CallUsage", () => {
    const u = summarizeUsage(undefined, {
      _tag: "TokenUsage",
      callId: "a",
      tokensTotal: 30,
      tokensIn: 10,
      tokensOut: 20,
      estimated: false,
      model: "m",
      provider: "p",
      durationMs: 1000,
      firstTokenMs: 250,
      costUsd: 0,
    });
    expect(u.calls[0]?.firstTokenMs).toBe(250);
  });
});
