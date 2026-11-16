// Run: REACTIVE_AGENTS_NO_AUTO_SHADOW=1 bun test packages/llm-provider/tests/capability-hosted-rows.test.ts --timeout 15000
//
// Hosted models UIs commonly select must resolve to a static row, never the
// made-up 4096 fallback window (Cortex refuses to show a fallback window).

import { describe, it, expect } from "bun:test";
import { resolveCapability } from "../src/capability-resolver.js";

const ROWS: ReadonlyArray<readonly [string, string, number, number]> = [
  ["openai", "gpt-4.1", 1_047_576, 32_768],
  ["openai", "gpt-4.1-mini", 1_047_576, 32_768],
  ["openai", "gpt-4.1-nano", 1_047_576, 32_768],
  ["openai", "o4-mini", 200_000, 100_000],
  ["anthropic", "claude-opus-4-1", 200_000, 32_000],
  ["gemini", "gemini-2.0-flash", 1_048_576, 8_192],
];

describe("hosted-model capability rows", () => {
  for (const [provider, model, window, out] of ROWS) {
    it(`${provider}/${model} resolves to a static row with its real window`, () => {
      const cap = resolveCapability(provider, model);
      expect(cap.source).not.toBe("fallback");
      expect(cap.maxContextTokens).toBe(window);
      expect(cap.maxOutputTokens).toBe(out);
    });
  }

  it("o4-mini is flagged as a reasoning model (max_completion_tokens)", () => {
    const cap = resolveCapability("openai", "o4-mini");
    expect(cap.requiresMaxCompletionTokens).toBe(true);
    expect(cap.supportsThinkingMode).toBe(true);
  });
});
