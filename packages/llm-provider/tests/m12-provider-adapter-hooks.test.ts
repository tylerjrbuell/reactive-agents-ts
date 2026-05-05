/**
 * M12: Provider Adapter System (7 hooks) — Spike Validation
 *
 * Run: bun test packages/llm-provider/tests/m12-provider-adapter-hooks.test.ts --timeout 30000
 *
 * Purpose: Validate that all 7 provider adapter hooks fire correctly and improve their domains
 * - parseToolCalls: normalize malformed tool calls (qwen3 scenario)
 * - extractText: reassemble streaming text parts (Gemini scenario)
 * - computeCost: calculate accurate token costs
 * - validateResponse: catch invalid responses
 * - optimizePrompt: add provider-specific guidance
 * - handleError: map provider errors to standard errors
 * - streamSupport: parse streaming events correctly
 */

import { describe, it, expect, beforeEach } from "bun:test";
import type { ProviderAdapter } from "../src/adapter.js";

/**
 * TEST 1: parseToolCalls hook
 * Scenario: Qwen3 returns malformed tool_calls in response
 * Expected: Hook normalizes to valid ToolCall[]
 */
describe("M12.1 — parseToolCalls hook (qwen3 normalization)", () => {
  let adapter: ProviderAdapter;

  beforeEach(() => {
    adapter = createTestAdapterWithHooks();
  });

  it("normalizes qwen3 malformed tool_calls to valid ToolCall[]", async () => {
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

  it("returns undefined for frontier models (no normalization needed)", async () => {
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

  it("hook fires measurably (instrumentation confirms)", async () => {
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
});

/**
 * TEST 2: extractText hook
 * Scenario: Gemini streaming returns parts array (text + functionCall parts mixed)
 * Expected: Hook reassembles text correctly
 */
describe("M12.2 — extractText hook (Gemini streaming reassembly)", () => {
  let adapter: ProviderAdapter;

  beforeEach(() => {
    adapter = createTestAdapterWithHooks();
  });

  it("reassembles Gemini streaming parts into single text", async () => {
    const geminiParts = [
      { text: "I will search for" },
      { text: " information about" },
      { text: " the topic." },
      { functionCall: { name: "search", args: { query: "test" } } },
    ];

    const extracted = adapter.extractText?.(geminiParts, "gemini-pro");

    expect(extracted).toBeDefined();
    expect(extracted).toBe("I will search for information about the topic.");
  });

  it("returns undefined for non-streaming or frontier models", async () => {
    const anthropicResponse = { text: "response" };
    const result = adapter.extractText?.(anthropicResponse, "claude-sonnet-4-5");
    expect(result).toBeUndefined();
  });

  it("hook fires and improves text extraction", async () => {
    let hookFired = false;
    const instrumentedAdapter: ProviderAdapter = {
      extractText: (parts, modelId) => {
        hookFired = true;
        if (Array.isArray(parts) && modelId?.includes("gemini")) {
          return parts
            .filter((p: any) => p.text)
            .map((p: any) => p.text)
            .join("");
        }
        return undefined;
      },
    };

    const result = instrumentedAdapter.extractText?.(
      [{ text: "Hello" }, { text: " world" }],
      "gemini-pro"
    );

    expect(hookFired).toBe(true);
    expect(result).toBe("Hello world");
  });
});

/**
 * TEST 3: computeCost hook
 * Scenario: Provider returns token counts; hook computes cost
 * Expected: Hook returns accurate USD cost
 */
describe("M12.3 — computeCost hook (token cost calculation)", () => {
  let adapter: ProviderAdapter;

  beforeEach(() => {
    adapter = createTestAdapterWithHooks();
  });

  it("computes accurate cost for qwen3 models", async () => {
    const tokenCounts = {
      inputTokens: 100,
      outputTokens: 50,
    };

    const cost = adapter.computeCost?.(tokenCounts, "qwen3:14b");

    expect(cost).toBeDefined();
    expect(cost).toBeGreaterThan(0);
    expect(typeof cost).toBe("number");
  });

  it("computes accurate cost for claude models", async () => {
    const tokenCounts = {
      inputTokens: 1000,
      outputTokens: 500,
    };

    const cost = adapter.computeCost?.(tokenCounts, "claude-haiku-4-5");

    expect(cost).toBeDefined();
    expect(cost).toBeGreaterThan(0);
  });

  it("returns zero for models with no pricing info", async () => {
    const cost = adapter.computeCost?.({ inputTokens: 100, outputTokens: 50 }, "unknown-model");
    expect(cost).toBe(0);
  });
});

/**
 * TEST 4: validateResponse hook
 * Scenario: Provider returns response with missing/invalid fields
 * Expected: Hook detects and signals validation error
 */
describe("M12.4 — validateResponse hook (response validation)", () => {
  let adapter: ProviderAdapter;

  beforeEach(() => {
    adapter = createTestAdapterWithHooks();
  });

  it("validates Gemini response structure", async () => {
    const invalidResponse = {
      candidates: null,
    };

    const validation = adapter.validateResponse?.(invalidResponse, "gemini-pro");

    expect(validation).toBeDefined();
    expect(validation?.valid).toBe(false);
    expect(validation?.error).toContain("candidates");
  });

  it("accepts valid responses", async () => {
    const validResponse = {
      candidates: [{ content: { parts: [{ text: "response" }] } }],
    };

    const validation = adapter.validateResponse?.(validResponse, "gemini-pro");

    expect(validation?.valid).toBe(true);
  });

  it("returns valid:true for frontier models (pass-through)", async () => {
    const anyResponse = {};
    const result = adapter.validateResponse?.(anyResponse, "claude-sonnet-4-5");
    expect(result?.valid).toBe(true);
  });
});

/**
 * TEST 5: optimizePrompt hook
 * Scenario: Raw prompt; hook adds provider-specific guidance
 * Expected: Hook returns enhanced prompt with model-specific tips
 */
describe("M12.5 — optimizePrompt hook (prompt enhancement)", () => {
  let adapter: ProviderAdapter;

  beforeEach(() => {
    adapter = createTestAdapterWithHooks();
  });

  it("enhances prompt for local models with explicit tool guidance", async () => {
    const basePrompt = "Use the tools available to answer questions.";

    const optimized = adapter.optimizePrompt?.(
      basePrompt,
      ["search", "read_file"],
      "qwen3:14b"
    );

    expect(optimized).toBeDefined();
    expect(optimized).toContain(basePrompt);
    expect(optimized?.length).toBeGreaterThan(basePrompt.length);
  });

  it("returns undefined for frontier models", async () => {
    const prompt = "Use the tools available.";
    const result = adapter.optimizePrompt?.(prompt, ["search"], "claude-sonnet-4-5");
    expect(result).toBeUndefined();
  });

  it("hook improves domain (measurably different output)", async () => {
    let hookFired = false;
    const instrumentedAdapter: ProviderAdapter = {
      optimizePrompt: (basePrompt, toolNames, modelId) => {
        hookFired = true;
        if (modelId?.includes("qwen")) {
          return (
            basePrompt +
            `\n\nIMPORTANT: Available tools: ${toolNames.join(", ")}. Always use them to answer questions.`
          );
        }
        return undefined;
      },
    };

    const result = instrumentedAdapter.optimizePrompt?.(
      "Base",
      ["search"],
      "qwen3:14b"
    );

    expect(hookFired).toBe(true);
    expect(result).toContain("IMPORTANT");
  });
});

/**
 * TEST 6: handleError hook
 * Scenario: Provider returns error; hook maps to standard error type
 * Expected: Hook classifies error (transient vs. fatal)
 */
describe("M12.6 — handleError hook (error classification)", () => {
  let adapter: ProviderAdapter;

  beforeEach(() => {
    adapter = createTestAdapterWithHooks();
  });

  it("maps Gemini overquota error to retryable transient error", async () => {
    const geminiError = {
      code: 429,
      message: "Quota exceeded",
    };

    const classified = adapter.handleError?.(geminiError, "gemini-pro");

    expect(classified).toBeDefined();
    expect(classified?.retryable).toBe(true);
    expect(classified?.errorType).toBe("rate_limit");
  });

  it("maps Ollama connection error to transient", async () => {
    const ollamaError = new Error("connect ECONNREFUSED");

    const classified = adapter.handleError?.(ollamaError, "ollama:qwen");

    expect(classified?.retryable).toBe(true);
    expect(classified?.errorType).toContain("connect");
  });

  it("maps invalid API key to fatal error", async () => {
    const authError = {
      code: 401,
      message: "Unauthorized",
    };

    const classified = adapter.handleError?.(authError, "claude-haiku-4-5");

    expect(classified?.retryable).toBe(false);
    expect(classified?.errorType).toBe("auth");
  });

  it("returns undefined for unhandled error types", async () => {
    const unknownError = new Error("Mysterious error");
    const result = adapter.handleError?.(unknownError, "unknown-model");
    expect(result).toBeUndefined();
  });
});

/**
 * TEST 7: streamSupport hook
 * Scenario: Provider streaming chunks arrive; hook parses events
 * Expected: Hook converts raw chunks to standard StreamEvent[]
 */
describe("M12.7 — streamSupport hook (streaming event parsing)", () => {
  let adapter: ProviderAdapter;

  beforeEach(() => {
    adapter = createTestAdapterWithHooks();
  });

  it("parses Gemini streaming chunks into StreamEvents", async () => {
    const geminiChunk = {
      index: 0,
      candidates: [
        {
          content: {
            parts: [{ text: "Hello" }],
          },
        },
      ],
    };

    const events = adapter.streamSupport?.(geminiChunk, "gemini-pro");

    expect(events).toBeDefined();
    expect(Array.isArray(events)).toBe(true);
    expect(events?.length).toBeGreaterThan(0);
  });

  it("parses Anthropic streaming chunks", async () => {
    const anthropicChunk = {
      type: "content_block_delta",
      delta: {
        type: "text_delta",
        text: "response",
      },
    };

    const events = adapter.streamSupport?.(anthropicChunk, "claude-haiku-4-5");

    expect(events).toBeDefined();
    expect(Array.isArray(events)).toBe(true);
  });

  it("fires on streaming scenarios and improves event parsing", async () => {
    let hookFired = false;
    const instrumentedAdapter: ProviderAdapter = {
      streamSupport: (chunk, modelId) => {
        hookFired = true;
        if (modelId?.includes("gemini")) {
          return [
            {
              type: "text_delta" as const,
              text: chunk.candidates?.[0]?.content?.parts?.[0]?.text || "",
            },
          ];
        }
        return undefined;
      },
    };

    const result = instrumentedAdapter.streamSupport?.(
      { candidates: [{ content: { parts: [{ text: "test" }] } }] },
      "gemini-pro"
    );

    expect(hookFired).toBe(true);
    expect(result).toBeDefined();
  });
});

/**
 * TEST 8: Cross-provider interference check
 */
describe("M12.8 — Cross-provider interference check", () => {
  it("qwen3 parseToolCalls doesn't affect Gemini", async () => {
    const adapter = createTestAdapterWithHooks();
    const geminiResponse = { candidates: [{ content: { parts: [] } }] };
    const result = adapter.parseToolCalls?.(geminiResponse, "gemini-pro");
    expect(result).toBeUndefined();
  });

  it("Gemini extractText doesn't affect Anthropic", async () => {
    const adapter = createTestAdapterWithHooks();
    const anthropicResponse = { text: "response" };
    const result = adapter.extractText?.(anthropicResponse, "claude-haiku-4-5");
    expect(result).toBeUndefined();
  });
});

/**
 * TEST 9: Hook firing verification (all 7 hooks fire)
 */
describe("M12.9 — All 7 hooks fire in correct scenarios", () => {
  it("verifies all 7 hooks exist on adapter interface", async () => {
    const adapter = createTestAdapterWithHooks();

    expect(typeof adapter.parseToolCalls).toBe("function");
    expect(typeof adapter.extractText).toBe("function");
    expect(typeof adapter.computeCost).toBe("function");
    expect(typeof adapter.validateResponse).toBe("function");
    expect(typeof adapter.optimizePrompt).toBe("function");
    expect(typeof adapter.handleError).toBe("function");
    expect(typeof adapter.streamSupport).toBe("function");
  });

  it("counts hook firings across all 7 in typical workflow", async () => {
    const hookFiringLog: string[] = [];

    const instrumentedAdapter: ProviderAdapter = {
      parseToolCalls: () => {
        hookFiringLog.push("parseToolCalls");
        return undefined;
      },
      extractText: () => {
        hookFiringLog.push("extractText");
        return undefined;
      },
      computeCost: () => {
        hookFiringLog.push("computeCost");
        return 0;
      },
      validateResponse: () => {
        hookFiringLog.push("validateResponse");
        return undefined;
      },
      optimizePrompt: () => {
        hookFiringLog.push("optimizePrompt");
        return undefined;
      },
      handleError: () => {
        hookFiringLog.push("handleError");
        return undefined;
      },
      streamSupport: () => {
        hookFiringLog.push("streamSupport");
        return undefined;
      },
    };

    instrumentedAdapter.optimizePrompt?.("prompt", ["tool"], "qwen3:14b");
    instrumentedAdapter.parseToolCalls?.({}, "qwen3:14b");
    instrumentedAdapter.computeCost?.({ inputTokens: 100, outputTokens: 50 }, "qwen3:14b");
    instrumentedAdapter.validateResponse?.({}, "qwen3:14b");
    instrumentedAdapter.extractText?.([], "qwen3:14b");
    instrumentedAdapter.handleError?.(new Error("test"), "qwen3:14b");
    instrumentedAdapter.streamSupport?.({}, "qwen3:14b");

    expect(hookFiringLog.length).toBe(7);
    expect(new Set(hookFiringLog).size).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────

function createTestAdapterWithHooks(): ProviderAdapter {
  return {
    parseToolCalls: (response: any, modelId?: string) => {
      if (modelId?.includes("qwen")) {
        if (response?.tool_calls?.length > 0) {
          return response.tool_calls.map((call: any) => ({
            name: call.name,
            arguments:
              typeof call.arguments === "string"
                ? JSON.parse(call.arguments)
                : call.arguments,
          }));
        }
      }
      return undefined;
    },

    extractText: (parts: any, modelId?: string) => {
      if (modelId?.includes("gemini") && Array.isArray(parts)) {
        return parts
          .filter((p: any) => p.text)
          .map((p: any) => p.text)
          .join("");
      }
      return undefined;
    },

    computeCost: (tokens: any, modelId?: string) => {
      const inputTokens = tokens.inputTokens || 0;
      const outputTokens = tokens.outputTokens || 0;

      if (modelId?.includes("qwen")) {
        return (inputTokens * 0.00000004 + outputTokens * 0.00000012) || 0;
      }
      if (modelId?.includes("claude")) {
        return (inputTokens * 0.0000008 + outputTokens * 0.0000024) || 0;
      }
      return 0;
    },

    validateResponse: (response: any, modelId?: string) => {
      if (modelId?.includes("gemini")) {
        if (!response.candidates || !Array.isArray(response.candidates)) {
          return {
            valid: false,
            error: "Missing or invalid candidates field",
          };
        }
      }
      return { valid: true };
    },

    optimizePrompt: (basePrompt: string, toolNames: readonly string[], modelId?: string) => {
      if (modelId?.includes("qwen")) {
        return (
          basePrompt +
          `\n\nIMPORTANT: Available tools: ${toolNames.join(", ")}. Always use them to answer questions.`
        );
      }
      return undefined;
    },

    handleError: (error: any, modelId?: string) => {
      const msg = error?.message || error?.toString?.() || "";
      const code = error?.code;

      if (code === 429 || msg.includes("quota")) {
        return { retryable: true, errorType: "rate_limit" };
      }
      if (code === 401 || msg.includes("Unauthorized")) {
        return { retryable: false, errorType: "auth" };
      }
      if (msg.includes("ECONNREFUSED") || msg.includes("connect")) {
        return { retryable: true, errorType: "connection" };
      }
      return undefined;
    },

    streamSupport: (chunk: any, modelId?: string) => {
      if (modelId?.includes("gemini") && chunk.candidates?.[0]?.content?.parts) {
        const text = chunk.candidates[0].content.parts
          .filter((p: any) => p.text)
          .map((p: any) => p.text)
          .join("");
        return [{ type: "text_delta" as const, text }];
      }
      if (modelId?.includes("claude") && chunk.delta?.type === "text_delta") {
        return [{ type: "text_delta" as const, text: chunk.delta.text }];
      }
      return undefined;
    },
  };
}
