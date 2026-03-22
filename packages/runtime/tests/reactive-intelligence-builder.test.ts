import { describe, test, expect } from "bun:test";
import { ReactiveAgentBuilder } from "../src/builder.js";

describe("withReactiveIntelligence builder", () => {
  test("builder accepts withReactiveIntelligence()", () => {
    const builder = new ReactiveAgentBuilder()
      .withProvider("anthropic")
      .withReactiveIntelligence({
        entropy: { enabled: true },
      });
    expect(builder).toBeDefined();
  });

  test("builder accepts withReactiveIntelligence() with no args (defaults)", () => {
    const builder = new ReactiveAgentBuilder()
      .withProvider("anthropic")
      .withReactiveIntelligence();
    expect(builder).toBeDefined();
  });

  test("reactive intelligence is enabled by default", () => {
    const builder = new ReactiveAgentBuilder().withProvider("anthropic");
    const config = builder.toConfig();
    // RI on by default — features.reactiveIntelligence should be true
    expect(config.features?.reactiveIntelligence).toBe(true);
  });

  test("withReactiveIntelligence(false) disables RI", () => {
    const builder = new ReactiveAgentBuilder()
      .withProvider("anthropic")
      .withReactiveIntelligence(false);
    const config = builder.toConfig();
    // explicitly disabled — features.reactiveIntelligence should be false
    expect(config.features?.reactiveIntelligence).toBe(false);
  });

  test("withReactiveIntelligence(true) keeps RI enabled", () => {
    const builder = new ReactiveAgentBuilder()
      .withProvider("anthropic")
      .withReactiveIntelligence(false)
      .withReactiveIntelligence(true);
    const config = builder.toConfig();
    expect(config.features?.reactiveIntelligence).toBe(true);
  });
});
