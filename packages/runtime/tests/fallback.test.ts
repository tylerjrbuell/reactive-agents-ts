import { describe, test, expect } from "bun:test";
import { ReactiveAgentBuilder } from "../src/builder";

describe("Builder fallback integration", () => {
  test(".withFallbacks() sets fallback config on builder", () => {
    const builder = new ReactiveAgentBuilder();
    const result = builder.withFallbacks({
      providers: ["anthropic", "openai"],
      errorThreshold: 5,
    });
    // withFallbacks returns this for chaining
    expect(result).toBe(builder);
  });

  test(".withFallbacks() supports method chaining", () => {
    const builder = new ReactiveAgentBuilder();
    const result = builder
      .withName("test-agent")
      .withFallbacks({
        providers: ["anthropic", "openai"],
        models: ["claude-sonnet", "claude-haiku"],
        errorThreshold: 3,
      })
      .withProvider("anthropic");
    expect(result).toBe(builder);
  });

  test(".withFallbacks() with all optional fields", () => {
    const builder = new ReactiveAgentBuilder();
    const result = builder.withFallbacks({
      providers: ["anthropic", "openai", "gemini"],
      models: ["claude-sonnet-4-20250514", "claude-haiku-3-20250520"],
      errorThreshold: 5,
    });
    expect(result).toBe(builder);
  });

  test(".withFallbacks() with partial config", () => {
    const builder = new ReactiveAgentBuilder();
    const result = builder.withFallbacks({
      providers: ["anthropic", "openai"],
    });
    expect(result).toBe(builder);
  });

  test(".withFallbacks() with only error threshold", () => {
    const builder = new ReactiveAgentBuilder();
    const result = builder.withFallbacks({
      errorThreshold: 5,
    });
    expect(result).toBe(builder);
  });
});
