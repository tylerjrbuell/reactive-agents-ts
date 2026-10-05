// packages/llm-provider/tests/structured-usage-ref.test.ts
//
// Issue #232 Gap 1: `runStructuredParseWithRetry` used to discard the mapped
// response's `usage`, so native structured calls (plan generation, extraction)
// were unmetered and the run-scoped budget under-counted. This proves
// `completeStructured()` now writes the provider-reported usage to the
// fiber-local `StructuredUsageRef`, and that the ref is summed across
// parse-retry attempts.
//
// Uses the established module-mock seam (mock the `openai` SDK before importing
// the provider) — no real SDK call, no global fetch.
//
// Run: bun test packages/llm-provider/tests/structured-usage-ref.test.ts --timeout 15000

import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, FiberRef, Layer, Schema } from "effect";

// ─── Mock openai SDK BEFORE the provider module is imported ───

const mockCreate = mock(async (_opts: unknown) => ({
  choices: [
    {
      message: {
        content: JSON.stringify({ probability: 0.87 }),
        role: "assistant",
        tool_calls: undefined,
      },
      finish_reason: "stop",
      logprobs: null,
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
  },
  model: "mock-model",
}));

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

// ─── Lazy imports (after mock registration) ───

import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";

let OpenAIProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMService: typeof import("../src/index.js")["LLMService"];
let LLMConfig: typeof import("../src/index.js")["LLMConfig"];
let StructuredUsageRef: typeof import("../src/index.js")["StructuredUsageRef"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  OpenAIProviderLive = mod.OpenAIProviderLive;
  LLMService = mod.LLMService;
  LLMConfig = mod.LLMConfig;
  StructuredUsageRef = mod.StructuredUsageRef;
});

const ProbabilitySchema = Schema.Struct({ probability: Schema.Number });

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

describe("StructuredUsageRef", () => {
  it("starts null on a fresh fiber", async () => {
    const value = await Effect.runPromise(FiberRef.get(StructuredUsageRef));
    expect(value).toBeNull();
  });

  it("is populated with the provider's usage after completeStructured()", async () => {
    const usage = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        yield* llm.completeStructured({
          messages: [{ role: "user", content: "Give me a probability." }],
          outputSchema: ProbabilitySchema,
        });
        return yield* FiberRef.get(StructuredUsageRef);
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(usage).not.toBeNull();
    expect(usage?.inputTokens).toBe(10);
    expect(usage?.outputTokens).toBe(5);
    expect(usage?.totalTokens).toBeGreaterThan(0);
    expect(usage?.totalTokens).toBe(15);
  });

  it("sums usage across parse-retry attempts", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "not json",
              role: "assistant",
              tool_calls: undefined,
            },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: "mock-model",
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({ probability: 0.5 }),
              role: "assistant",
              tool_calls: undefined,
            },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 7, total_tokens: 27 },
        model: "mock-model",
      });

    const usage = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        yield* llm.completeStructured({
          messages: [{ role: "user", content: "Give me a probability." }],
          outputSchema: ProbabilitySchema,
          maxParseRetries: 2,
        });
        return yield* FiberRef.get(StructuredUsageRef);
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(usage).not.toBeNull();
    expect(usage?.inputTokens).toBe(30);
    expect(usage?.outputTokens).toBe(12);
    expect(usage?.totalTokens).toBe(42);
  });
});
