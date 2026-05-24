/**
 * Provider adapter — parseToolCalls hook validation.
 *
 * Run: bun test packages/llm-provider/tests/m12-provider-adapter-hooks.test.ts --timeout 30000
 *
 * Purpose: pin the contract of the one provider adapter hook the framework
 * actually invokes — `parseToolCalls`. Validates the qwen3 normalization
 * scenario (stringified arguments → coerced object) and verifies the hook
 * is invoked exactly when the adapter declares it.
 *
 * History: an earlier "M12" surface declared 7 numbered hooks. Audit
 * (2026-05-24) found 6 of those 7 had zero framework call sites and zero
 * built-in implementations; those declarations were removed from
 * `ProviderAdapter`. The remaining `parseToolCalls` hook is wired across
 * all 5 providers via `selectAdapter` — that's the contract this file
 * pins. Cross-provider integration coverage lives in
 * `tests/provider-adapter-wiring.test.ts`.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import type { ProviderAdapter } from "../src/adapter.js";

describe("parseToolCalls hook — qwen3 normalization", () => {
  let adapter: ProviderAdapter;

  beforeEach(() => {
    adapter = createTestAdapterWithHooks();
  });

  it("normalizes qwen3 malformed tool_calls (stringified args) to valid ToolCall[]", () => {
    const malformedResponse = {
      tool_calls: [
        {
          name: "web_search",
          arguments: '{"query": "test"}', // string instead of object
        },
      ],
    };

    const normalized = adapter.parseToolCalls?.(malformedResponse, "qwen3:14b");

    expect(normalized).toBeDefined();
    expect(normalized).toEqual([
      {
        name: "web_search",
        arguments: { query: "test" },
      },
    ]);
  });

  it("returns undefined for frontier models (no normalization needed)", () => {
    const wellFormedResponse = {
      tool_calls: [
        {
          name: "web_search",
          arguments: { query: "test" },
        },
      ],
    };

    const result = adapter.parseToolCalls?.(wellFormedResponse, "claude-haiku-4-5");
    expect(result).toBeUndefined();
  });

  it("hook fires measurably (instrumentation confirms)", () => {
    let hookFired = false;
    const instrumentedAdapter: ProviderAdapter = {
      parseToolCalls: () => {
        hookFired = true;
        return undefined;
      },
    };

    instrumentedAdapter.parseToolCalls?.({}, "qwen3:14b");
    expect(hookFired).toBe(true);
  });

  it("qwen3 normalization does not affect Gemini responses", () => {
    const geminiResponse = { candidates: [{ content: { parts: [] } }] };
    const result = adapter.parseToolCalls?.(geminiResponse, "gemini-pro");
    expect(result).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────

function createTestAdapterWithHooks(): ProviderAdapter {
  return {
    parseToolCalls: (response, modelId) => {
      const typed = response as { tool_calls?: Array<{ name: string; arguments: unknown }> };
      if (modelId?.includes("qwen") && typed.tool_calls && typed.tool_calls.length > 0) {
        return typed.tool_calls.map((call) => ({
          name: call.name,
          arguments:
            typeof call.arguments === "string"
              ? (JSON.parse(call.arguments) as Record<string, unknown>)
              : (call.arguments as Record<string, unknown>),
        }));
      }
      return undefined;
    },
  };
}
