import { describe, test, expect } from "bun:test";
import { FallbackChain } from "../src/fallback-chain";

describe("FallbackChain", () => {
  test("records errors and triggers provider fallback after threshold", () => {
    const chain = new FallbackChain({
      providers: ["anthropic", "openai"],
      errorThreshold: 3,
    });
    chain.recordError("anthropic");
    chain.recordError("anthropic");
    chain.recordError("anthropic");
    expect(chain.currentProvider()).toBe("openai");
  });

  test("triggers model fallback on rate limit", () => {
    const chain = new FallbackChain({
      providers: ["anthropic"],
      models: ["claude-sonnet-4-20250514", "claude-haiku-3-20250520"],
    });
    chain.recordRateLimit("anthropic");
    expect(chain.currentModel()).toBe("claude-haiku-3-20250520");
  });

  test("does not trigger fallback before threshold reached", () => {
    const chain = new FallbackChain({
      providers: ["anthropic", "openai"],
      errorThreshold: 3,
    });
    chain.recordError("anthropic");
    chain.recordError("anthropic");
    expect(chain.currentProvider()).toBe("anthropic");
  });

  test("exhausts fallback chain and reports no fallback available", () => {
    const chain = new FallbackChain({
      providers: ["anthropic"],
      errorThreshold: 1,
    });
    chain.recordError("anthropic");
    expect(chain.hasFallback()).toBe(false);
  });

  test("resets error counts on successful call", () => {
    const chain = new FallbackChain({
      providers: ["anthropic", "openai"],
      errorThreshold: 3,
    });
    chain.recordError("anthropic");
    chain.recordError("anthropic");
    chain.recordSuccess("anthropic");
    chain.recordError("anthropic"); // count restarted from 0, only 1 now
    expect(chain.currentProvider()).toBe("anthropic");
  });
});

describe("FallbackChain onFallback callback", () => {
  test("calls onFallback when threshold is exceeded and provider switches", () => {
    const calls: Array<{ from: string; to: string; reason: string; attempt: number }> = [];

    const chain = new FallbackChain(
      { providers: ["anthropic", "openai"], errorThreshold: 2 },
      (from, to, reason, attempt) => {
        calls.push({ from, to, reason, attempt });
      },
    );

    chain.recordError("anthropic");
    expect(calls).toHaveLength(0);

    chain.recordError("anthropic");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.from).toBe("anthropic");
    expect(calls[0]?.to).toBe("openai");
    expect(calls[0]?.reason).toContain("error");
    expect(calls[0]?.attempt).toBeGreaterThan(0);
  });

  test("does not throw when callback is not provided", () => {
    const chain = new FallbackChain({
      providers: ["anthropic", "openai"],
      errorThreshold: 1,
    });

    expect(() => chain.recordError("anthropic")).not.toThrow();
  });
});
