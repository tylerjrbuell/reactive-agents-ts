// Run: bun test packages/llm-provider/tests/local-adapter-parser-hook.test.ts --timeout 15000
//
// GH #46 — pin per-provider tool-call parser hook (M12 Hook 1/7) consumption
// in the local (Ollama) provider. Validates that the provider invokes
// selectAdapter() per CompletionRequest and consumes adapter.parseToolCalls
// when supplied, falling back to the default Ollama-shaped parser otherwise.

import { describe, it, expect, mock, beforeAll, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import type { ProviderAdapter } from "../src/adapter.js";

// ─── Adapter swap seam ──────────────────────────────────────────────────
//
// The local provider imports `selectAdapter` from "../adapter.js" at module
// load time. To control what adapter the provider sees per test, we replace
// that module with a thin wrapper around the REAL `selectAdapter` (captured
// via namespace import below), with a swap point (`overrideAdapter`) tests
// can set.

let overrideAdapter: ProviderAdapter | null = null;

// We rebuild a minimal selectAdapter inline rather than delegating back to
// the real module (delegating causes recursion through the mocked binding).
// For the default path we just return `{ adapter: localModelAdapter }` since
// that's what selectAdapter does for tier="local" with no calibration.
import { localModelAdapter, defaultAdapter, midModelAdapter } from "../src/adapter.js";

mock.module("../src/adapter.js", () => ({
  // Preserve named exports the rest of the package may import.
  localModelAdapter,
  defaultAdapter,
  midModelAdapter,
  selectAdapter: (
    _caps: { supportsToolCalling: boolean },
    tier?: string,
    _modelId?: string,
  ) => {
    if (overrideAdapter) {
      return { adapter: overrideAdapter };
    }
    if (tier === "local") return { adapter: localModelAdapter };
    if (tier === "mid") return { adapter: midModelAdapter };
    return { adapter: defaultAdapter };
  },
}));

// ─── Mock the `ollama` SDK ───

const mockChat = mock(async (_opts: unknown) => ({
  model: "qwen3:14b",
  message: {
    role: "assistant",
    content: "",
    tool_calls: [] as Array<{
      function: { name: string; arguments: unknown };
    }>,
  },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 10,
  eval_count: 5,
}));

const mockEmbed = mock(async (_opts: unknown) => ({ embeddings: [] }));
const mockShow = mock(async (_opts: { model: string }) => ({
  capabilities: ["completion", "tools"],
  template: "default",
}));

mock.module("ollama", () => ({
  Ollama: class MockOllama {
    constructor(_opts?: { host?: string }) {}
    chat = mockChat;
    embed = mockEmbed;
    show = mockShow;
  },
}));

// ─── Lazily resolved imports (after mock.module is installed) ───

import type { LLMService as LLMServiceType } from "../src/index.js";

let LocalProviderLive: Layer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  LocalProviderLive = mod.LocalProviderLive as Layer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

afterEach(() => {
  overrideAdapter = null;
});

const makeLayer = () => {
  const cfg = LLMConfig.of({
    defaultProvider: "ollama",
    defaultModel: "qwen3:14b",
    ollamaEndpoint: "http://localhost:11434",
    embeddingConfig: {
      model: "nomic-embed-text",
      dimensions: 3,
      provider: "ollama",
      batchSize: 100,
    },
    supportsPromptCaching: false,
    maxRetries: 1,
    timeoutMs: 30_000,
    defaultMaxTokens: 1024,
    defaultTemperature: 0.7,
  });
  return LocalProviderLive.pipe(
    Layer.provide(Layer.succeed(LLMConfig, cfg)),
  );
};

const run = <A>(eff: Effect.Effect<A, unknown, LLMServiceType>) =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(makeLayer() as Layer.Layer<LLMServiceType, unknown>),
    ),
  );

// ─── Tests ───

describe("local provider — M12 Hook 1/7 (parseToolCalls) consumption", () => {
  it("falls back to default Ollama parser when no adapter parseToolCalls is supplied", async () => {
    // overrideAdapter stays null → real selectAdapter runs → uncalibrated
    // qwen3:14b yields localModelAdapter (no parseToolCalls). The default
    // Ollama parser must run, producing canonical ToolCall shape.
    mockChat.mockResolvedValueOnce({
      model: "qwen3:14b",
      message: {
        role: "assistant",
        content: "calling tool",
        tool_calls: [
          {
            function: {
              name: "web_search",
              arguments: { query: "default-parser-path" },
            },
          },
        ],
      },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 10,
      eval_count: 5,
    });

    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "qwen3:14b",
        });
      }),
    );

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].name).toBe("web_search");
    expect(result.toolCalls?.[0].input).toEqual({ query: "default-parser-path" });
    expect(result.toolCalls?.[0].id).toMatch(/^ollama-tc-/);
  });

  it("invokes adapter.parseToolCalls and uses its output when supplied (default parser does NOT run)", async () => {
    overrideAdapter = {
      parseToolCalls: (_response, _modelId) => [
        {
          name: "adapter_normalized_tool",
          arguments: { from: "adapter-hook" },
        },
      ],
    };

    // Mocked Ollama response carries a DIFFERENT tool_calls shape than what
    // we expect to surface. If the adapter hook is consumed, the adapter's
    // output appears instead.
    mockChat.mockResolvedValueOnce({
      model: "qwen3:14b",
      message: {
        role: "assistant",
        content: "stub",
        tool_calls: [
          {
            function: {
              name: "raw_ollama_tool",
              arguments: { from: "raw-ollama" },
            },
          },
        ],
      },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 10,
      eval_count: 5,
    });

    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "qwen3:14b",
        });
      }),
    );

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls).toHaveLength(1);
    // Adapter output wins; default Ollama-shaped parser is NOT invoked.
    expect(result.toolCalls?.[0].name).toBe("adapter_normalized_tool");
    expect(result.toolCalls?.[0].input).toEqual({ from: "adapter-hook" });
  });

  it("qwen3 stringified-args coexistence — adapter parses to Record, thinking field preserved", async () => {
    // Realistic qwen3 failure mode: tool_calls has string arguments AND the
    // response carries a `thinking` block. After adapter normalization both
    // surfaces (toolCalls + thinking) must be present and well-formed.
    overrideAdapter = {
      parseToolCalls: (response, modelId) => {
        if (!modelId?.includes("qwen")) return undefined;
        const tcs = (response as {
          message?: {
            tool_calls?: Array<{
              function: { name: string; arguments: unknown };
            }>;
          };
        })?.message?.tool_calls;
        if (!tcs?.length) return undefined;
        return tcs.map((tc) => ({
          name: tc.function.name,
          arguments:
            typeof tc.function.arguments === "string"
              ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
              : (tc.function.arguments as Record<string, unknown>),
        }));
      },
    };

    mockChat.mockResolvedValueOnce({
      model: "qwen3:14b",
      message: {
        role: "assistant",
        content: "answer body",
        thinking: "internal reasoning trace",
        tool_calls: [
          {
            function: {
              name: "web_search",
              arguments: '{"query": "stringified"}',
            },
          },
        ],
      },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 10,
      eval_count: 5,
    });

    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "do work" }],
          model: "qwen3:14b",
        });
      }),
    );

    // Adapter normalized stringified JSON args to a real object
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].name).toBe("web_search");
    expect(result.toolCalls?.[0].input).toEqual({ query: "stringified" });
    // thinking preserved on the CompletionResponse surface
    expect(result.thinking).toBe("internal reasoning trace");
    expect(result.thinking?.length).toBeGreaterThan(0);
    expect((result.toolCalls ?? []).length).toBeGreaterThan(0);
  });
});
