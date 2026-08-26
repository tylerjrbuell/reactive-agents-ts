// packages/llm-provider/tests/gemini-cache-usage.test.ts
// Cost-instrument truth (2026-08): gemini.ts read usageMetadata.cachedContentTokenCount
// for calculateCost() pricing but discarded it — never surfaced onto the returned
// usage object. Fixed to also set usage.cacheReadInputTokens (conditionally,
// mirroring anthropic.ts's idiom — absent means "not reported", never a false 0).
//
// Pattern mirrors anthropic-prompt-caching.test.ts's
// "surfaces cacheCreationInputTokens + cacheReadInputTokens in usage" test.
//
// Run: bun test packages/llm-provider/tests/gemini-cache-usage.test.ts --timeout 15000

import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, Layer } from "effect";

let mockUsageMetadata: Record<string, unknown> = {
  promptTokenCount: 12,
  candidatesTokenCount: 8,
  totalTokenCount: 20,
};

const mockGenerateContent = mock(async (_opts: unknown) => ({
  text: "Gemini mock response",
  functionCalls: undefined as Array<{ name: string; args: unknown }> | undefined,
  usageMetadata: mockUsageMetadata,
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

describe("Gemini cache-read usage surfacing", () => {
  it("surfaces cacheReadInputTokens in usage when reported", async () => {
    mockUsageMetadata = {
      promptTokenCount: 12,
      candidatesTokenCount: 8,
      totalTokenCount: 20,
      cachedContentTokenCount: 7,
    };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hi" }],
        });
      }).pipe(Effect.provide(makeTestLayer())),
    );

    expect(result.usage.cacheReadInputTokens).toBe(7);
  });

  it("omits cacheReadInputTokens when no cache field is reported", async () => {
    mockUsageMetadata = {
      promptTokenCount: 12,
      candidatesTokenCount: 8,
      totalTokenCount: 20,
    };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hi" }],
        });
      }).pipe(Effect.provide(makeTestLayer())),
    );

    expect(result.usage.cacheReadInputTokens).toBeUndefined();
    expect("cacheReadInputTokens" in result.usage).toBe(false);
  });
});
