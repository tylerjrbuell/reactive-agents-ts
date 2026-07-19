// Run: bun test packages/llm-provider/tests/provider-adapter-wiring.test.ts --timeout 15000
//
// GH #46 followup — M12 Hook 1/7 (parseToolCalls) consumption parity across
// the 4 non-local providers (anthropic, openai, gemini, litellm). Mirrors
// `local-adapter-parser-hook.test.ts` but at layer-integration level for the
// cloud providers. Validates each provider:
//
//   1. invokes adapter.parseToolCalls and uses its output when supplied,
//   2. falls through to the default extraction when the adapter declines
//      (returns undefined),
//   3. behaves as today when no calibration is registered (real selectAdapter
//      yields the tier adapter which lacks parseToolCalls).
//
// Streaming behavior is intentionally NOT covered here — providers buffer
// raw tool calls and synthesize start+delta pairs at end-of-stream when
// `parseToolCalls` is registered, but exhaustive stream mocking is gated to
// follow-up work (see upward-report). The wiring is symmetric to complete()
// and exercised by the local provider's existing stream tests.

import { describe, it, expect, mock, beforeAll, afterAll, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import type { ProviderAdapter } from "../src/adapter.js";
import {
  localModelAdapter,
  defaultAdapter,
  midModelAdapter,
} from "../src/adapter.js";

// ─── Adapter swap seam (shared across all provider suites) ─────────────────

let overrideAdapter: ProviderAdapter | null = null;

mock.module("../src/adapter.js", () => ({
  localModelAdapter,
  defaultAdapter,
  midModelAdapter,
  selectAdapter: (
    _caps: { supportsToolCalling: boolean },
    tier?: string,
    _modelId?: string,
  ) => {
    if (overrideAdapter) return { adapter: overrideAdapter };
    if (tier === "local") return { adapter: localModelAdapter };
    if (tier === "mid") return { adapter: midModelAdapter };
    return { adapter: defaultAdapter };
  },
}));

// ─── SDK mocks ─────────────────────────────────────────────────────────────

// Anthropic — `@anthropic-ai/sdk` lazily required via `require(...).default`
type AnthropicCreateResponse = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
};

const mockAnthropicCreate = mock(async (_opts: unknown): Promise<AnthropicCreateResponse> => ({
  content: [],
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 5 },
  model: "claude-haiku-4-5",
}));

// COMPLETE mock: anthropic.ts stream() calls `client.messages.stream(...)` and
// registers `.on("streamEvent"|"finalMessage"|"error", cb)` handlers
// (anthropic.ts:325..467). A mock lacking `stream` turns any cross-file leak of
// this module mock into "client.messages.stream is not a function" for every
// later suite that touches the Anthropic streaming path. Mirror the mockStream
// shape from anthropic-provider.test.ts: register handlers, then fire
// finalMessage on a microtask so the Effect stream completes deterministically.
const mockAnthropicStream = mock((_opts: unknown) => {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  queueMicrotask(() => {
    handlers.finalMessage?.({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
      model: "claude-haiku-4-5",
    });
  });
  return {
    on: (ev: string, cb: (...a: unknown[]) => void) => {
      handlers[ev] = cb;
    },
  };
});

// Bun module mocks are process-global and leak across test FILES. Capture the
// real module and re-install it in afterAll (Bun has no unmock; re-mocking
// with the real exports is the documented restore) so later files — e.g.
// runtime live-Anthropic tests — hit the real SDK again.
const realAnthropicSdk = { ...(await import("@anthropic-ai/sdk")) };
afterAll(() => {
  mock.module("@anthropic-ai/sdk", () => realAnthropicSdk);
});

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    constructor(_opts?: { apiKey?: string }) {}
    messages = { create: mockAnthropicCreate, stream: mockAnthropicStream };
  },
}));

// OpenAI — `openai` lazily required via `require(...).default`
type OpenAICreateResponse = {
  choices: Array<{
    message: {
      content: string | null;
      role: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model: string;
};

const mockOpenAICreate = mock(async (_opts: unknown): Promise<OpenAICreateResponse> => ({
  choices: [
    {
      message: { content: "", role: "assistant" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  model: "gpt-4o",
}));

mock.module("openai", () => ({
  default: class MockOpenAI {
    constructor(_opts?: { apiKey?: string }) {}
    chat = { completions: { create: mockOpenAICreate } };
    embeddings = { create: async () => ({ data: [] }) };
  },
}));

// Gemini — `@google/genai` dynamic-imported
type GeminiResponse = {
  text: string;
  functionCalls?: Array<{ name: string; args: unknown }>;
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
};

const mockGenerateContent = mock(async (_opts: unknown): Promise<GeminiResponse> => ({
  text: "",
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
}));

mock.module("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    constructor(_opts?: { apiKey?: string }) {}
    models = {
      generateContent: mockGenerateContent,
      generateContentStream: async () => ({ [Symbol.asyncIterator]: async function* () {} }),
      embedContent: async () => ({ embeddings: [] }),
    };
  },
}));

// LiteLLM — uses global `fetch`
type LiteLLMFetchResponse = {
  choices: Array<{
    message: {
      content: string | null;
      role: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model: string;
};

let liteLLMNextResponse: LiteLLMFetchResponse = {
  choices: [
    {
      message: { content: "", role: "assistant" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  model: "anthropic/claude-3-5-sonnet-20241022",
};

// Scope the fetch monkey-patch to this file's lifecycle so workspace runs
// don't inherit the mock and break later HTTP-based suites (pricing, A2A,
// MCP HTTP transports, health).
const originalFetch = globalThis.fetch;
const mockFetch = (async (_url: unknown, _opts?: unknown) => ({
  ok: true,
  status: 200,
  json: async () => liteLLMNextResponse,
  text: async () => "",
  body: null,
})) as typeof fetch;

// ─── Lazily resolved imports (after mock.module is installed) ──────────────

import type { LLMService as LLMServiceType } from "../src/index.js";

let AnthropicProviderLive: Layer.Layer<LLMServiceType>;
let OpenAIProviderLive: Layer.Layer<LLMServiceType>;
let GeminiProviderLive: Layer.Layer<LLMServiceType>;
let LiteLLMProviderLive: Layer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  globalThis.fetch = mockFetch;
  const mod = await import("../src/index.js");
  AnthropicProviderLive = mod.AnthropicProviderLive as Layer.Layer<LLMServiceType>;
  OpenAIProviderLive = mod.OpenAIProviderLive as Layer.Layer<LLMServiceType>;
  GeminiProviderLive = mod.GeminiProviderLive as Layer.Layer<LLMServiceType>;
  LiteLLMProviderLive = mod.LiteLLMProviderLive as Layer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  overrideAdapter = null;
});

const baseCfg = {
  embeddingConfig: {
    model: "text-embedding-3-small",
    dimensions: 3,
    provider: "openai" as const,
    batchSize: 100,
  },
  supportsPromptCaching: false,
  maxRetries: 1,
  timeoutMs: 30_000,
  defaultMaxTokens: 1024,
  defaultTemperature: 0.7,
};

const makeAnthropicLayer = () =>
  AnthropicProviderLive.pipe(
    Layer.provide(
      Layer.succeed(
        LLMConfig,
        LLMConfig.of({
          defaultProvider: "anthropic",
          defaultModel: "claude-haiku-4-5",
          anthropicApiKey: "test-key",
          ...baseCfg,
        }),
      ),
    ),
  );

const makeOpenAILayer = () =>
  OpenAIProviderLive.pipe(
    Layer.provide(
      Layer.succeed(
        LLMConfig,
        LLMConfig.of({
          defaultProvider: "openai",
          defaultModel: "gpt-4o",
          openaiApiKey: "test-key",
          ...baseCfg,
        }),
      ),
    ),
  );

const makeGeminiLayer = () =>
  GeminiProviderLive.pipe(
    Layer.provide(
      Layer.succeed(
        LLMConfig,
        LLMConfig.of({
          defaultProvider: "gemini",
          defaultModel: "gemini-2.5-flash",
          googleApiKey: "test-key",
          ...baseCfg,
        }),
      ),
    ),
  );

const makeLiteLLMLayer = () =>
  LiteLLMProviderLive.pipe(
    Layer.provide(
      Layer.succeed(
        LLMConfig,
        LLMConfig.of({
          defaultProvider: "litellm",
          defaultModel: "anthropic/claude-3-5-sonnet-20241022",
          ...baseCfg,
        }),
      ),
    ),
  );

const runWith = <A>(
  layer: Layer.Layer<LLMServiceType>,
  eff: Effect.Effect<A, unknown, LLMServiceType>,
) =>
  Effect.runPromise(
    eff.pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
  );

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("anthropic — M12 Hook 1/7 (parseToolCalls) wiring", () => {
  it("falls back to default extraction when no adapter parseToolCalls is supplied", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: "thinking..." },
        {
          type: "tool_use",
          id: "toolu_abc",
          name: "web_search",
          input: { query: "default-parser-path" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
      model: "claude-haiku-4-5",
    });

    const result = await runWith(
      makeAnthropicLayer(),
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "claude-haiku-4-5",
        });
      }),
    );

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].id).toBe("toolu_abc");
    expect(result.toolCalls?.[0].name).toBe("web_search");
    expect(result.toolCalls?.[0].input).toEqual({ query: "default-parser-path" });
  });

  it("invokes adapter.parseToolCalls and uses its output when supplied", async () => {
    overrideAdapter = {
      parseToolCalls: (_response, _modelId) => [
        { name: "adapter_normalized_tool", arguments: { from: "adapter-hook" } },
      ],
    };
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_original",
          name: "raw_tool",
          input: { from: "raw" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
      model: "claude-haiku-4-5",
    });

    const result = await runWith(
      makeAnthropicLayer(),
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "claude-haiku-4-5",
        });
      }),
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].name).toBe("adapter_normalized_tool");
    expect(result.toolCalls?.[0].input).toEqual({ from: "adapter-hook" });
    // id-fallback policy: preserve raw Anthropic id at same index when present
    expect(result.toolCalls?.[0].id).toBe("toolu_original");
  });

  it("adapter returns undefined → falls through to default extraction (back-compat)", async () => {
    overrideAdapter = {
      parseToolCalls: () => undefined,
    };
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_xyz",
          name: "real_tool",
          input: { real: true },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
      model: "claude-haiku-4-5",
    });

    const result = await runWith(
      makeAnthropicLayer(),
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "claude-haiku-4-5",
        });
      }),
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].name).toBe("real_tool");
    expect(result.toolCalls?.[0].input).toEqual({ real: true });
    expect(result.toolCalls?.[0].id).toBe("toolu_xyz");
  });
});

describe("openai — M12 Hook 1/7 (parseToolCalls) wiring", () => {
  it("falls back to default extraction when no adapter parseToolCalls is supplied", async () => {
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "",
            role: "assistant",
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: {
                  name: "web_search",
                  arguments: '{"query":"default-parser-path"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: "gpt-4o",
    });

    const result = await runWith(
      makeOpenAILayer(),
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "gpt-4o",
        });
      }),
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].id).toBe("call_abc");
    expect(result.toolCalls?.[0].name).toBe("web_search");
    expect(result.toolCalls?.[0].input).toEqual({ query: "default-parser-path" });
  });

  it("invokes adapter.parseToolCalls and uses its output when supplied", async () => {
    overrideAdapter = {
      parseToolCalls: (_response, _modelId) => [
        { name: "normalized", arguments: { from: "adapter" } },
      ],
    };
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "",
            role: "assistant",
            tool_calls: [
              {
                id: "call_original",
                type: "function",
                function: { name: "raw_tool", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: "gpt-4o",
    });

    const result = await runWith(
      makeOpenAILayer(),
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "gpt-4o",
        });
      }),
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].name).toBe("normalized");
    expect(result.toolCalls?.[0].input).toEqual({ from: "adapter" });
    expect(result.toolCalls?.[0].id).toBe("call_original");
  });

  it("adapter returns undefined → falls through to default extraction", async () => {
    overrideAdapter = { parseToolCalls: () => undefined };
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "",
            role: "assistant",
            tool_calls: [
              {
                id: "call_xyz",
                type: "function",
                function: { name: "real_tool", arguments: '{"real":true}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: "gpt-4o",
    });

    const result = await runWith(
      makeOpenAILayer(),
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "gpt-4o",
        });
      }),
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].id).toBe("call_xyz");
    expect(result.toolCalls?.[0].name).toBe("real_tool");
    expect(result.toolCalls?.[0].input).toEqual({ real: true });
  });
});

describe("gemini — M12 Hook 1/7 (parseToolCalls) wiring", () => {
  it("falls back to default extraction when no adapter parseToolCalls is supplied", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: "",
      functionCalls: [{ name: "web_search", args: { query: "default-parser-path" } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });

    const result = await runWith(
      makeGeminiLayer(),
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "gemini-2.5-flash",
        });
      }),
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].id).toBe("call_0");
    expect(result.toolCalls?.[0].name).toBe("web_search");
    expect(result.toolCalls?.[0].input).toEqual({ query: "default-parser-path" });
  });

  it("invokes adapter.parseToolCalls and uses its output when supplied", async () => {
    overrideAdapter = {
      parseToolCalls: (_response, _modelId) => [
        { name: "normalized", arguments: { from: "adapter" } },
      ],
    };
    mockGenerateContent.mockResolvedValueOnce({
      text: "",
      functionCalls: [{ name: "raw_tool", args: { from: "raw" } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });

    const result = await runWith(
      makeGeminiLayer(),
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "gemini-2.5-flash",
        });
      }),
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].name).toBe("normalized");
    expect(result.toolCalls?.[0].input).toEqual({ from: "adapter" });
    expect(result.toolCalls?.[0].id).toBe("call_0");
  });

  it("adapter returns undefined → falls through to default extraction", async () => {
    overrideAdapter = { parseToolCalls: () => undefined };
    mockGenerateContent.mockResolvedValueOnce({
      text: "",
      functionCalls: [{ name: "real_tool", args: { real: true } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });

    const result = await runWith(
      makeGeminiLayer(),
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "gemini-2.5-flash",
        });
      }),
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].name).toBe("real_tool");
    expect(result.toolCalls?.[0].input).toEqual({ real: true });
  });
});

describe("litellm — M12 Hook 1/7 (parseToolCalls) wiring", () => {
  it("falls back to default extraction when no adapter parseToolCalls is supplied", async () => {
    liteLLMNextResponse = {
      choices: [
        {
          message: {
            content: "",
            role: "assistant",
            tool_calls: [
              {
                id: "call_litellm_abc",
                type: "function",
                function: {
                  name: "web_search",
                  arguments: '{"query":"default-parser-path"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: "anthropic/claude-3-5-sonnet-20241022",
    };

    const result = await runWith(
      makeLiteLLMLayer(),
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "anthropic/claude-3-5-sonnet-20241022",
        });
      }),
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].id).toBe("call_litellm_abc");
    expect(result.toolCalls?.[0].name).toBe("web_search");
    expect(result.toolCalls?.[0].input).toEqual({ query: "default-parser-path" });
  });

  it("invokes adapter.parseToolCalls and uses its output when supplied", async () => {
    overrideAdapter = {
      parseToolCalls: (_response, _modelId) => [
        { name: "normalized", arguments: { from: "adapter" } },
      ],
    };
    liteLLMNextResponse = {
      choices: [
        {
          message: {
            content: "",
            role: "assistant",
            tool_calls: [
              {
                id: "call_litellm_original",
                type: "function",
                function: { name: "raw_tool", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: "anthropic/claude-3-5-sonnet-20241022",
    };

    const result = await runWith(
      makeLiteLLMLayer(),
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "anthropic/claude-3-5-sonnet-20241022",
        });
      }),
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].name).toBe("normalized");
    expect(result.toolCalls?.[0].input).toEqual({ from: "adapter" });
    expect(result.toolCalls?.[0].id).toBe("call_litellm_original");
  });

  it("adapter returns undefined → falls through to default extraction", async () => {
    overrideAdapter = { parseToolCalls: () => undefined };
    liteLLMNextResponse = {
      choices: [
        {
          message: {
            content: "",
            role: "assistant",
            tool_calls: [
              {
                id: "call_litellm_xyz",
                type: "function",
                function: { name: "real_tool", arguments: '{"real":true}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: "anthropic/claude-3-5-sonnet-20241022",
    };

    const result = await runWith(
      makeLiteLLMLayer(),
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "anthropic/claude-3-5-sonnet-20241022",
        });
      }),
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].id).toBe("call_litellm_xyz");
    expect(result.toolCalls?.[0].name).toBe("real_tool");
    expect(result.toolCalls?.[0].input).toEqual({ real: true });
  });
});

// Restore fetch on module exit — not strictly necessary in Bun's isolated
// test runner but defensive against shared globals.
afterEach(() => {
  // no-op; globalThis.fetch swap persists for all tests in this file.
});

// Final cleanup — only restore fetch if tests in other files depend on it.
// Bun reloads modules per test file, so this is paranoid hygiene.
void originalFetch;
