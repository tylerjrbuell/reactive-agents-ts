// packages/llm-provider/tests/groq-xai-provider.test.ts
// Groq + xAI providers reuse the OpenAI-compatible adapter, parameterized by
// baseURL + API-key source. These tests lock:
//   1. the SDK client is constructed with the right baseURL + key per provider
//   2. embeddings are rejected with a descriptive error (no endpoint)
//   3. capability resolution keeps native-fc (seeded rows + provider fallback)
//   4. the runtime dispatch wires groq/xai to their layers
//
// Run: bun test packages/llm-provider/tests/groq-xai-provider.test.ts --timeout 15000

import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, Layer } from "effect";

// ─── Capture BOTH constructor opts and create() body ───

let capturedCtor: { apiKey?: string; baseURL?: string } | null = null;

const mockCreate = mock(async () => ({
  choices: [
    {
      message: { content: "ok", role: "assistant", tool_calls: undefined },
      finish_reason: "stop",
      logprobs: null,
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  model: "mock-model",
}));

mock.module("openai", () => ({
  default: class MockOpenAI {
    constructor(opts: { apiKey?: string; baseURL?: string }) {
      capturedCtor = opts;
    }
    chat = { completions: { create: mockCreate } };
    embeddings = { create: mock(async () => ({ data: [] })) };
  },
}));

// ─── Lazy imports (after mock registration) ───

import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";

let GroqProviderLive: EffectLayer.Layer<LLMServiceType>;
let XAIProviderLive: EffectLayer.Layer<LLMServiceType>;
let OpenAIProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMService: typeof import("../src/index.js")["LLMService"];
let LLMConfig: typeof import("../src/index.js")["LLMConfig"];
let resolveCapability: typeof import("../src/index.js")["resolveCapability"];
let createLLMProviderLayer: typeof import("../src/index.js")["createLLMProviderLayer"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  GroqProviderLive = mod.GroqProviderLive;
  XAIProviderLive = mod.XAIProviderLive;
  OpenAIProviderLive = mod.OpenAIProviderLive;
  LLMService = mod.LLMService;
  LLMConfig = mod.LLMConfig;
  resolveCapability = mod.resolveCapability;
  createLLMProviderLayer = mod.createLLMProviderLayer;
});

// ─── Helpers ───

function makeConfig(overrides: Record<string, unknown>) {
  return LLMConfig.of({
    defaultProvider: "openai",
    defaultModel: "gpt-4o",
    defaultMaxTokens: 4096,
    defaultTemperature: 0.7,
    supportsPromptCaching: false,
    maxRetries: 0,
    timeoutMs: 15_000,
    embeddingConfig: {
      model: "text-embedding-3-small",
      dimensions: 1536,
      provider: "openai",
      batchSize: 100,
    },
    ...overrides,
  });
}

async function runComplete(
  layer: EffectLayer.Layer<LLMServiceType>,
  config: ReturnType<typeof makeConfig>,
  model: string,
) {
  capturedCtor = null;
  return Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* llm.complete({
        model,
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 128,
      });
    }).pipe(Effect.provide(Layer.provide(layer, Layer.succeed(LLMConfig, config)))),
  );
}

// ─── Client construction ───

describe("OpenAI-compatible client construction", () => {
  it("Groq → base URL api.groq.com + GROQ key", async () => {
    await runComplete(
      GroqProviderLive,
      makeConfig({ groqApiKey: "groq-secret", defaultModel: "llama-3.3-70b-versatile" }),
      "llama-3.3-70b-versatile",
    );
    expect(capturedCtor?.baseURL).toBe("https://api.groq.com/openai/v1");
    expect(capturedCtor?.apiKey).toBe("groq-secret");
  }, 15000);

  it("Groq base URL override respects groqBaseUrl", async () => {
    await runComplete(
      GroqProviderLive,
      makeConfig({ groqApiKey: "k", groqBaseUrl: "https://proxy.internal/v1", defaultModel: "llama-3.1-8b-instant" }),
      "llama-3.1-8b-instant",
    );
    expect(capturedCtor?.baseURL).toBe("https://proxy.internal/v1");
  }, 15000);

  it("xAI → base URL api.x.ai + XAI key", async () => {
    await runComplete(
      XAIProviderLive,
      makeConfig({ xaiApiKey: "xai-secret", defaultModel: "grok-4" }),
      "grok-4",
    );
    expect(capturedCtor?.baseURL).toBe("https://api.x.ai/v1");
    expect(capturedCtor?.apiKey).toBe("xai-secret");
  }, 15000);

  it("OpenAI → no base URL override, OPENAI key", async () => {
    await runComplete(
      OpenAIProviderLive,
      makeConfig({ openaiApiKey: "oai-secret" }),
      "gpt-4o",
    );
    expect(capturedCtor?.baseURL).toBeUndefined();
    expect(capturedCtor?.apiKey).toBe("oai-secret");
  }, 15000);
});

// ─── Embeddings unsupported ───

describe("embeddings unsupported on Groq/xAI", () => {
  it("Groq embed() fails with a descriptive error", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.embed(["hello"]);
      }).pipe(
        Effect.provide(Layer.provide(GroqProviderLive, Layer.succeed(LLMConfig, makeConfig({ groqApiKey: "k" })))),
        Effect.flip,
      ),
    );
    expect(String((result as { message?: string }).message)).toContain("embeddings");
  }, 15000);
});

// ─── Logprobs unsupported (Groq/xAI reject them) ───

describe("logprobs gated off for Groq/xAI", () => {
  it("Groq capabilities() reports supportsLogprobs=false", async () => {
    const caps = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.capabilities();
      }).pipe(Effect.provide(Layer.provide(GroqProviderLive, Layer.succeed(LLMConfig, makeConfig({ groqApiKey: "k" }))))),
    );
    expect(caps.supportsLogprobs).toBe(false);
  }, 15000);

  it("Groq complete({logprobs:true}) does NOT forward logprobs to the SDK", async () => {
    let body: Record<string, unknown> | null = null;
    mockCreate.mockImplementationOnce(async (b: unknown) => {
      body = b as Record<string, unknown>;
      return {
        choices: [{ message: { content: "ok", role: "assistant" }, finish_reason: "stop", logprobs: null }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        model: "llama-3.3-70b-versatile",
      };
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        yield* llm.complete({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: "hi" }],
          maxTokens: 64,
          logprobs: true,
          topLogprobs: 5,
        });
      }).pipe(Effect.provide(Layer.provide(GroqProviderLive, Layer.succeed(LLMConfig, makeConfig({ groqApiKey: "k" }))))),
    );
    expect(body!.logprobs).toBeUndefined();
    expect(body!.top_logprobs).toBeUndefined();
  }, 15000);
});

// ─── Capability resolution keeps native-fc ───

describe("Groq/xAI capability resolution", () => {
  it("seeded Groq model resolves native-fc from the static table", () => {
    const cap = resolveCapability("groq", "llama-3.3-70b-versatile");
    expect(cap.toolCallDialect).toBe("native-fc");
    expect(cap.source).toBe("static-table");
  });

  it("UNLISTED Groq model falls back to native-fc, NOT none", () => {
    const cap = resolveCapability("groq", "some-brand-new-groq-model-v9");
    expect(cap.toolCallDialect).toBe("native-fc");
    expect(cap.source).toBe("fallback");
    // sane window, not the 2048 conservative local default
    expect(cap.recommendedNumCtx).toBeGreaterThanOrEqual(32_768);
  });

  it("seeded xAI model resolves native-fc", () => {
    const cap = resolveCapability("xai", "grok-4");
    expect(cap.toolCallDialect).toBe("native-fc");
    expect(cap.supportsVision).toBe(true);
  });

  it("unknown non-hosted provider still gets the conservative none fallback", () => {
    const cap = resolveCapability("some-random-local", "mystery");
    expect(cap.toolCallDialect).toBe("none");
  });
});

// ─── Runtime dispatch ───

describe("runtime dispatch", () => {
  it("createLLMProviderLayer('groq') builds and reports provider=groq", async () => {
    const provider = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const cfg = yield* llm.getModelConfig();
        return cfg.provider;
      }).pipe(Effect.provide(createLLMProviderLayer("groq"))),
    );
    expect(provider).toBe("groq");
  }, 15000);

  it("createLLMProviderLayer('xai') builds and reports provider=xai", async () => {
    const provider = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const cfg = yield* llm.getModelConfig();
        return cfg.provider;
      }).pipe(Effect.provide(createLLMProviderLayer("xai"))),
    );
    expect(provider).toBe("xai");
  }, 15000);
});
