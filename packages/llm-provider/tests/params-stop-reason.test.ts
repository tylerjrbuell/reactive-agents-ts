// Run: bun test packages/llm-provider/tests/params-stop-reason.test.ts
//
// Pins the shared mapStopReason table to the EXACT per-provider ternary
// ladders it replaced (transcribed from the pre-consolidation sources):
//
//   local.ts complete()/stream():  done_reason "stop"→end_turn,
//     "length"→max_tokens, else end_turn (tool_use decided by caller)
//   anthropic.ts mapAnthropicResponse(): stop_reason end_turn/max_tokens/
//     stop_sequence/tool_use pass through, else end_turn (no caller override)
//   openai.ts mapOpenAIResponse():  finish_reason "tool_calls"→tool_use,
//     "stop"→end_turn, "length"→max_tokens, else end_turn
//   gemini.ts mapGeminiResponse():  finishReason IGNORED — always end_turn
//     (tool_use decided from functionCalls by caller; non-OK reasons error
//     out via the W22 guard before mapping)
//   litellm.ts mapLiteLLMResponse(): identical to openai

import { describe, it, expect } from "bun:test";
import { mapStopReason } from "../src/params/stop-reason.js";

describe("mapStopReason — anthropic ladder", () => {
  it("passes the four canonical stop_reason tokens through", () => {
    expect(mapStopReason("end_turn", "anthropic")).toBe("end_turn");
    expect(mapStopReason("max_tokens", "anthropic")).toBe("max_tokens");
    expect(mapStopReason("stop_sequence", "anthropic")).toBe("stop_sequence");
    expect(mapStopReason("tool_use", "anthropic")).toBe("tool_use");
  });

  it("degrades unknown tokens to end_turn (ladder default)", () => {
    expect(mapStopReason("refusal", "anthropic")).toBe("end_turn");
    expect(mapStopReason("pause_turn", "anthropic")).toBe("end_turn");
  });
});

describe("mapStopReason — openai-compat ladder (openai/groq/xai/litellm)", () => {
  for (const provider of ["openai", "groq", "xai", "litellm"] as const) {
    it(`${provider}: tool_calls→tool_use, stop→end_turn, length→max_tokens, else end_turn`, () => {
      expect(mapStopReason("tool_calls", provider)).toBe("tool_use");
      expect(mapStopReason("stop", provider)).toBe("end_turn");
      expect(mapStopReason("length", provider)).toBe("max_tokens");
      expect(mapStopReason("content_filter", provider)).toBe("end_turn");
      expect(mapStopReason("function_call", provider)).toBe("end_turn");
    });
  }
});

describe("mapStopReason — ollama ladder", () => {
  it("done_reason stop→end_turn, length→max_tokens, else end_turn", () => {
    expect(mapStopReason("stop", "ollama")).toBe("end_turn");
    expect(mapStopReason("length", "ollama")).toBe("max_tokens");
    expect(mapStopReason("load", "ollama")).toBe("end_turn");
    expect(mapStopReason("unload", "ollama")).toBe("end_turn");
  });
});

describe("mapStopReason — gemini (finishReason intentionally unmapped)", () => {
  it("every token degrades to end_turn, matching the pre-consolidation mapper", () => {
    expect(mapStopReason("STOP", "gemini")).toBe("end_turn");
    expect(mapStopReason("MAX_TOKENS", "gemini")).toBe("end_turn");
    expect(mapStopReason("SAFETY", "gemini")).toBe("end_turn");
    expect(mapStopReason("UNEXPECTED_TOOL_CALL", "gemini")).toBe("end_turn");
  });
});

describe("mapStopReason — null/undefined/unknown-provider handling", () => {
  it("null and undefined tokens degrade to end_turn", () => {
    expect(mapStopReason(null, "anthropic")).toBe("end_turn");
    expect(mapStopReason(undefined, "openai")).toBe("end_turn");
    expect(mapStopReason(undefined, "ollama")).toBe("end_turn");
  });

  it("unknown providers degrade to end_turn", () => {
    expect(mapStopReason("stop", "some-future-provider")).toBe("end_turn");
  });
});
