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
});
