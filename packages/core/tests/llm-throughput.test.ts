import { describe, expect, it } from "bun:test";
import { outputTokensPerSecond } from "../src/index.js";

describe("outputTokensPerSecond", () => {
  it("excludes time-to-first-token from the window", () => {
    // 100 tokens over (1500 - 500) ms = 100 tok/s
    expect(outputTokensPerSecond({ durationMs: 1500, firstTokenMs: 500, tokensOut: 100 })).toBe(100);
  });

  it("uses the whole duration when firstTokenMs is absent", () => {
    expect(outputTokensPerSecond({ durationMs: 2000, tokensOut: 100 })).toBe(50);
  });

  it("is undefined when tokensOut is absent", () => {
    expect(outputTokensPerSecond({ durationMs: 2000, firstTokenMs: 100 })).toBeUndefined();
  });

  it("is undefined when the generation window is zero or negative", () => {
    expect(outputTokensPerSecond({ durationMs: 500, firstTokenMs: 500, tokensOut: 10 })).toBeUndefined();
    expect(outputTokensPerSecond({ durationMs: 400, firstTokenMs: 500, tokensOut: 10 })).toBeUndefined();
    expect(outputTokensPerSecond({ durationMs: 0, tokensOut: 10 })).toBeUndefined();
  });

  it("is undefined when durationMs is NaN", () => {
    expect(outputTokensPerSecond({ durationMs: Number.NaN, tokensOut: 10 })).toBeUndefined();
  });

  it("returns 0 for a measured window with zero output tokens", () => {
    expect(outputTokensPerSecond({ durationMs: 1000, firstTokenMs: 200, tokensOut: 0 })).toBe(0);
  });
});
