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
