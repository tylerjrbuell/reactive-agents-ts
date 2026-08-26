// packages/llm-provider/tests/openai-cache-usage.test.ts
// Cost-instrument truth (2026-08): openai.ts read prompt_tokens_details.cached_tokens
// for calculateCost() pricing but discarded it — never surfaced onto the returned
// usage object. Fixed to also set usage.cacheReadInputTokens (conditionally,
// mirroring anthropic.ts's idiom — absent means "not reported", never a false 0).
//
// Pattern mirrors anthropic-prompt-caching.test.ts's
// "surfaces cacheCreationInputTokens + cacheReadInputTokens in usage" test.
//
// Run: bun test packages/llm-provider/tests/openai-cache-usage.test.ts --timeout 15000

import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, Layer } from "effect";

let capturedCreateOpts: Record<string, unknown> | null = null;
let mockUsage: Record<string, unknown> = {
  prompt_tokens: 10,
  completion_tokens: 5,
  total_tokens: 15,
};

const mockCreate = mock(async (opts: unknown) => {
  capturedCreateOpts = opts as Record<string, unknown>;
  return {
    choices: [
      {
        message: { content: "ok", role: "assistant", tool_calls: undefined },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: mockUsage,
    model: "mock-model",
  };
});

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
    embeddings = {
      create: mock(async () => ({ data: [] })),
    };
  },
}));

import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";

let OpenAIProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMService: typeof import("../src/index.js")["LLMService"];
let LLMConfig: typeof import("../src/index.js")["LLMConfig"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  OpenAIProviderLive = mod.OpenAIProviderLive;
  LLMService = mod.LLMService;
  LLMConfig = mod.LLMConfig;
});

function makeLayer() {
  return Layer.provide(
    OpenAIProviderLive,
    Layer.succeed(
      LLMConfig,
      LLMConfig.of({
        defaultProvider: "openai",
        defaultModel: "gpt-4o",
        openaiApiKey: "test-key",
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
      }),
    ),
  );
}

describe("OpenAI cache-read usage surfacing", () => {
  it("surfaces cacheReadInputTokens in usage when reported", async () => {
    capturedCreateOpts = null;
    mockUsage = {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 8 },
    };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hi" }],
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(result.usage.cacheReadInputTokens).toBe(8);
  });

  it("omits cacheReadInputTokens when no cache field is reported", async () => {
    capturedCreateOpts = null;
    mockUsage = {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hi" }],
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(result.usage.cacheReadInputTokens).toBeUndefined();
    expect("cacheReadInputTokens" in result.usage).toBe(false);
  });
});
