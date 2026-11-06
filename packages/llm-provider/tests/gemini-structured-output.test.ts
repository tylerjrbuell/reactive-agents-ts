// packages/llm-provider/tests/gemini-structured-output.test.ts
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
// Run: bun test packages/llm-provider/tests/gemini-structured-output.test.ts --timeout 15000

import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, FiberRef, Layer, Schema } from "effect";
import { StructuredUsageRef } from "../src/structured-parse-retry.js";

// ─── Mock @google/genai BEFORE the provider module is imported ───

const mockGenerateContent = mock(async (_opts: unknown) => ({
  text: JSON.stringify({ probability: 0.87 }),
  functionCalls: undefined as Array<{ name: string; args: unknown }> | undefined,
  candidates: undefined as Array<{ finishReason?: string }> | undefined,
  usageMetadata: {
    promptTokenCount: 12,
    candidatesTokenCount: 8,
    totalTokenCount: 20,
  },
}));

mock.module("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      generateContent: mockGenerateContent,
      generateContentStream: mock(async () => (async function* () {})()),
      embedContent: mock(async () => ({ embeddings: [] })),
    };
  },
}));

// ─── Types (imported at top level via static import) ───
import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";

let GeminiProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  GeminiProviderLive = mod.GeminiProviderLive as EffectLayer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

const ProbabilitySchema = Schema.Struct({ probability: Schema.Number });

const makeTestLayer = () => {
  const testConfig = LLMConfig.of({
    defaultProvider: "gemini",
    defaultModel: "gemini-2.0-flash",
    googleApiKey: "test-api-key",
    embeddingConfig: {
      model: "gemini-embedding-001",
      dimensions: 4,
      provider: "openai",
      batchSize: 100,
    },
    supportsPromptCaching: false,
    maxRetries: 1,
    timeoutMs: 30_000,
    defaultMaxTokens: 1024,
    defaultTemperature: 0.7,
  });

  return GeminiProviderLive.pipe(
    Layer.provide(Layer.succeed(LLMConfig, testConfig)),
  );
};

const run = <A>(effect: Effect.Effect<A, unknown, LLMServiceType>) => {
  const layer = makeTestLayer();
  return Effect.runPromise(
    effect.pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
  );
};

describe("GeminiProviderLive completeStructured() — schema build regression", () => {
  it("builds a valid JSON schema string and does not throw (JSONSchema.make regression)", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.completeStructured({
          messages: [{ role: "user", content: "Give me a probability." }],
          outputSchema: ProbabilitySchema,
        });
      }),
    );

    expect(result).toEqual({ probability: 0.87 });
    expect(mockGenerateContent).toHaveBeenCalled();
  });
});

// H3 instrument gap 1 (2026-11-06): per-attempt report from the Gemini path.
// The raw finishReason is reported (the gemini table maps none, so the
// normalized value would read end_turn on a truncation); no thinkingChars
// (includeThoughts is not requested, so no thought text comes back).
describe("GeminiProviderLive completeStructured() — per-attempt report", () => {
  it("reports the raw finish reason and tokens per attempt on StructuredUsageRef", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: "{\"prob",
      functionCalls: undefined,
      candidates: [{ finishReason: "MAX_TOKENS" }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 256, totalTokenCount: 268 },
    });

    const ref = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        yield* llm.completeStructured({
          messages: [{ role: "user", content: "Give me a probability." }],
          outputSchema: ProbabilitySchema,
        });
        return yield* FiberRef.get(StructuredUsageRef);
      }),
    );

    expect(ref?.attempts).toEqual([
      { attempt: 0, parsed: false, inputTokens: 12, outputTokens: 256, stopReason: "MAX_TOKENS" },
      { attempt: 1, parsed: true, inputTokens: 12, outputTokens: 8 },
    ]);
  });
});
