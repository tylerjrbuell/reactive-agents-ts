// packages/llm-provider/tests/openai-structured-output.test.ts
// Regression: completeStructured() built its JSON Schema string via
// Schema.encodedSchema(request.outputSchema), which returns another Effect
// Schema instance (not a JSON-serializable object). JSON.stringify() on it
// silently evaluated to `undefined`, and the downstream JSON.parse("undefined")
// threw "SyntaxError: JSON Parse error: Unexpected identifier undefined".
// Fixed by swapping in JSONSchema.make(), which returns a real
// JSON-Schema-shaped plain object.
//
// This test exercises the FULL completeStructured() pipeline (schema build +
// SDK call + parse) against a real Schema.Struct, matching the shape used by
// @reactive-agents/judgment's buildBatchSchema (`{ probability: number }`).
//
// Run: bun test packages/llm-provider/tests/openai-structured-output.test.ts --timeout 15000

import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, Layer, Schema } from "effect";

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

beforeAll(async () => {
  const mod = await import("../src/index.js");
  OpenAIProviderLive = mod.OpenAIProviderLive;
  LLMService = mod.LLMService;
  LLMConfig = mod.LLMConfig;
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

describe("OpenAIProviderLive completeStructured() — schema build regression", () => {
  it("builds a valid JSON schema string and does not throw (JSONSchema.make regression)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.completeStructured({
          messages: [{ role: "user", content: "Give me a probability." }],
          outputSchema: ProbabilitySchema,
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(result).toEqual({ probability: 0.87 });
    expect(mockCreate).toHaveBeenCalled();
  });
});
