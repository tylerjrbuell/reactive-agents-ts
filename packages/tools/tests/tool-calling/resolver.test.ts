import { describe, it, expect } from "bun:test";
import { createToolCallResolver } from "../../src/tool-calling/resolver.js";
import { NativeFCStrategy } from "../../src/tool-calling/native-fc-strategy.js";
import type { ProviderCapabilities } from "@reactive-agents/llm-provider";

describe("createToolCallResolver", () => {
  it("returns NativeFCStrategy when supportsToolCalling is true", () => {
    const caps: ProviderCapabilities = {
      supportsToolCalling: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsLogprobs: false,
    };
    const resolver = createToolCallResolver(caps);
    expect(resolver).toBeInstanceOf(NativeFCStrategy);
  });

  it("throws when no tool calling and no structured output", () => {
    const caps: ProviderCapabilities = {
      supportsToolCalling: false,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsLogprobs: false,
    };
    expect(() => createToolCallResolver(caps)).toThrow(
      "Provider supports neither native tool calling nor structured output."
    );
  });
});
