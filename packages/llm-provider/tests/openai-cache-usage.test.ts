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
import { Effect, Layer, Stream } from "effect";

let capturedCreateOpts: Record<string, unknown> | null = null;
let mockUsage: Record<string, unknown> = {
  prompt_tokens: 10,
  completion_tokens: 5,
  total_tokens: 15,
};
// Streaming path: openai.ts assigns `finalUsage = chunk.usage` wholesale
// (no 0-vs-absent accumulator like Gemini's), so this can stay undefined
// to simulate "final chunk never carried a usage field".
let mockStreamUsage: Record<string, unknown> | undefined = {
  prompt_tokens: 10,
  completion_tokens: 5,
};

async function* mockStreamChunks() {
  yield {
    choices: [{ delta: { content: "ok" }, finish_reason: undefined }],
  };
  yield {
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage: mockStreamUsage,
  };
}

const mockCreate = mock(async (opts: unknown) => {
  capturedCreateOpts = opts as Record<string, unknown>;
  const streamRequested = (opts as { stream?: boolean }).stream === true;
  if (streamRequested) {
    return mockStreamChunks();
  }
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

describe("OpenAI cache-read usage surfacing (complete())", () => {
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

describe("OpenAI cache-read usage surfacing (stream())", () => {
  it("surfaces cacheReadInputTokens on the streamed usage event when reported", async () => {
    capturedCreateOpts = null;
    mockStreamUsage = {
      prompt_tokens: 10,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 4 },
    };

    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "hi" }],
        });
        return yield* Stream.runCollect(stream);
      }).pipe(Effect.provide(makeLayer())),
    );

    const usage = Array.from(events).find((e) => e.type === "usage") as
      | { type: "usage"; usage: Record<string, unknown> }
      | undefined;
    expect(usage).toBeDefined();
    expect(usage!.usage.cacheReadInputTokens).toBe(4);
  });

  it("omits cacheReadInputTokens on the streamed usage event when no cache field is reported", async () => {
    capturedCreateOpts = null;
    mockStreamUsage = {
      prompt_tokens: 10,
      completion_tokens: 5,
    };

    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "hi" }],
        });
        return yield* Stream.runCollect(stream);
      }).pipe(Effect.provide(makeLayer())),
    );

    const usage = Array.from(events).find((e) => e.type === "usage") as
      | { type: "usage"; usage: Record<string, unknown> }
      | undefined;
    expect(usage).toBeDefined();
    expect(usage!.usage.cacheReadInputTokens).toBeUndefined();
    expect("cacheReadInputTokens" in usage!.usage).toBe(false);
  });
});
