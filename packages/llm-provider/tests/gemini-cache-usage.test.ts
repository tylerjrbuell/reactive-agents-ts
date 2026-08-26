// packages/llm-provider/tests/gemini-cache-usage.test.ts
// Cost-instrument truth (2026-08): gemini.ts read usageMetadata.cachedContentTokenCount
// for calculateCost() pricing but discarded it — never surfaced onto the returned
// usage object. Fixed to also set usage.cacheReadInputTokens (conditionally,
// mirroring anthropic.ts's idiom — absent means "not reported", never a false 0).
//
// Pattern mirrors anthropic-prompt-caching.test.ts's
// "surfaces cacheCreationInputTokens + cacheReadInputTokens in usage" test.
//
// The streaming path got a SECOND, independent bug on first pass: the
// per-chunk accumulator collapsed "chunk never reported the field" and
// "chunk reported it as genuinely 0" into the same local (`?? 0`), so even
// a correct `typeof` check at the emit site couldn't recover the lost
// information. Fixed by making the accumulator `number | undefined` and
// only overwriting on a genuine `typeof === "number"` chunk read — these
// streaming tests exist specifically to catch a regression of that class,
// since the complete()-path tests below did NOT catch it the first time.
//
// Run: bun test packages/llm-provider/tests/gemini-cache-usage.test.ts --timeout 15000

import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

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

// Streaming: each test sets this to the chunk usageMetadata the mocked
// stream should report on its final chunk (or leaves it undefined to
// simulate a chunk that never carries a cache field at all).
let mockStreamUsageMetadata: Record<string, unknown> | undefined = {
  promptTokenCount: 12,
  candidatesTokenCount: 8,
};

async function* mockStreamGenerator() {
  yield { text: "Hello", usageMetadata: undefined };
  yield { text: " World", usageMetadata: mockStreamUsageMetadata };
}
const mockGenerateContentStream = mock(
  async (_opts: unknown) => mockStreamGenerator(),
);

mock.module("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
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

describe("Gemini cache-read usage surfacing (complete())", () => {
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

describe("Gemini cache-read usage surfacing (stream())", () => {
  it("surfaces cacheReadInputTokens on the streamed usage event when a chunk reports it", async () => {
    mockStreamUsageMetadata = {
      promptTokenCount: 12,
      candidatesTokenCount: 8,
      cachedContentTokenCount: 5,
    };

    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "hi" }],
        });
        return yield* Stream.runCollect(stream);
      }).pipe(Effect.provide(makeTestLayer())),
    );

    const usage = Array.from(events).find((e) => e.type === "usage") as
      | { type: "usage"; usage: { cacheReadInputTokens?: number } }
      | undefined;
    expect(usage).toBeDefined();
    expect(usage!.usage.cacheReadInputTokens).toBe(5);
  });

  it("omits cacheReadInputTokens on the streamed usage event when no chunk reports it", async () => {
    // No chunk ever carries cachedContentTokenCount — this is the exact
    // regression class the Critical finding caught: a `0`-initialized
    // accumulator collapsed this case with "reported 0".
    mockStreamUsageMetadata = {
      promptTokenCount: 12,
      candidatesTokenCount: 8,
    };

    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "hi" }],
        });
        return yield* Stream.runCollect(stream);
      }).pipe(Effect.provide(makeTestLayer())),
    );

    const usage = Array.from(events).find((e) => e.type === "usage") as
      | { type: "usage"; usage: Record<string, unknown> }
      | undefined;
    expect(usage).toBeDefined();
    expect(usage!.usage.cacheReadInputTokens).toBeUndefined();
    expect("cacheReadInputTokens" in usage!.usage).toBe(false);
  });

  it("surfaces a genuine 0 cache-read count on the streamed usage event (not collapsed to absent)", async () => {
    mockStreamUsageMetadata = {
      promptTokenCount: 12,
      candidatesTokenCount: 8,
      cachedContentTokenCount: 0,
    };

    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "hi" }],
        });
        return yield* Stream.runCollect(stream);
      }).pipe(Effect.provide(makeTestLayer())),
    );

    const usage = Array.from(events).find((e) => e.type === "usage") as
      | { type: "usage"; usage: Record<string, unknown> }
      | undefined;
    expect(usage).toBeDefined();
    expect("cacheReadInputTokens" in usage!.usage).toBe(true);
    expect(usage!.usage.cacheReadInputTokens).toBe(0);
  });
});
