// packages/llm-provider/tests/gemini-token-split-honesty.test.ts
// Token-split honesty (2026-11): gemini.ts reported outputTokens =
// candidatesTokenCount alone and dropped thoughtsTokenCount, so thinking-model
// output was under-counted. The @google/genai SDK documents
// totalTokenCount = prompt + candidates + toolUse + thoughts, i.e. thoughts are
// NOT inside candidatesTokenCount. Fixed: outputTokens = candidates + thoughts,
// and thoughts is reported as reasoningTokens (a subset of outputTokens, same
// semantics as the OpenAI reasoningTokens field).
//
// Mocking convention mirrors gemini-stream-thinking.test.ts (module mock on
// @google/genai, restored in afterAll).
//
// Run: bun test packages/llm-provider/tests/gemini-token-split-honesty.test.ts --timeout 15000

afterAll(() => {
  mock.module("@google/genai", () => realGenaiModule);
});

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

const realGenaiModule: Record<string, unknown> = {
  ...(await import("@google/genai")),
};

type UsageMeta = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
};

let completeUsage: UsageMeta = {};
let streamChunks: Array<Record<string, unknown>> = [];

const mockGenerateContent = mock(async () => ({
  text: "ok",
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: "ok" }] } }],
  usageMetadata: completeUsage,
}));

const mockGenerateContentStream = mock(async (_opts: unknown) => {
  return (async function* () {
    for (const chunk of streamChunks) {
      yield chunk;
    }
  })();
});

mock.module("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
      embedContent: async () => ({ embeddings: [{ values: [0.1, 0.2] }] }),
    };
  },
}));

import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";
import type { StreamEvent } from "../src/types.js";

let GeminiProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  GeminiProviderLive = mod.GeminiProviderLive as EffectLayer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

const MODEL = "gemini-2.5-flash";

const makeLayer = () =>
  GeminiProviderLive.pipe(
    Layer.provide(
      Layer.succeed(
        LLMConfig,
        LLMConfig.of({
          defaultProvider: "gemini",
          defaultModel: MODEL,
          googleApiKey: "test-key",
          embeddingConfig: {
            model: "gemini-embedding-001",
            dimensions: 4,
            provider: "openai",
            batchSize: 100,
          },
          supportsPromptCaching: false,
          maxRetries: 0,
          timeoutMs: 30_000,
          defaultMaxTokens: 1024,
          defaultTemperature: 0.7,
        }),
      ),
    ),
  );

describe("gemini complete() — thoughts are part of output, reported as reasoning", () => {
  it("outputTokens = candidates + thoughts and reasoningTokens = thoughts", async () => {
    completeUsage = { promptTokenCount: 10, candidatesTokenCount: 6, thoughtsTokenCount: 20, totalTokenCount: 36 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({ messages: [{ role: "user", content: "2+2?" }], model: MODEL });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(result.usage.outputTokens).toBe(26);
    expect(result.usage.totalTokens).toBe(36);
    expect(result.usage.reasoningTokens).toBe(20);
  });

  it("omits reasoningTokens and keeps outputTokens = candidates when no thoughts reported", async () => {
    completeUsage = { promptTokenCount: 10, candidatesTokenCount: 6 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({ messages: [{ role: "user", content: "2+2?" }], model: MODEL });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(result.usage.outputTokens).toBe(6);
    expect("reasoningTokens" in result.usage).toBe(false);
  });
});

describe("gemini stream() — thoughts are part of output, reported as reasoning", () => {
  it("usage event outputTokens = candidates + thoughts and reasoningTokens = thoughts", async () => {
    streamChunks = [
      { candidates: [{ content: { parts: [{ text: "4" }] } }] },
      {
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: "" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6, thoughtsTokenCount: 20 } as UsageMeta,
      },
    ];
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({ messages: [{ role: "user", content: "2+2?" }], model: MODEL });
        return Array.from(yield* Stream.runCollect(stream)) as StreamEvent[];
      }).pipe(Effect.provide(makeLayer())),
    );

    const usage = events.find((e) => e.type === "usage") as
      | { type: "usage"; usage: { outputTokens: number; reasoningTokens?: number } }
      | undefined;
    expect(usage).toBeDefined();
    expect(usage!.usage.outputTokens).toBe(26);
    expect(usage!.usage.reasoningTokens).toBe(20);
  });
});

describe("gemini absent counts are unknown, not 0", () => {
  it("complete(): absent promptTokenCount and candidatesTokenCount are undefined", async () => {
    completeUsage = {};
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({ messages: [{ role: "user", content: "2+2?" }], model: MODEL });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(result.usage.inputTokens).toBeUndefined();
    expect(result.usage.outputTokens).toBeUndefined();
  });

  it("stream(): absent promptTokenCount stays undefined while candidates are reported", async () => {
    streamChunks = [
      { candidates: [{ content: { parts: [{ text: "4" }] } }] },
      {
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: "" }] } }],
        usageMetadata: { candidatesTokenCount: 6 } as UsageMeta,
      },
    ];
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({ messages: [{ role: "user", content: "2+2?" }], model: MODEL });
        return Array.from(yield* Stream.runCollect(stream)) as StreamEvent[];
      }).pipe(Effect.provide(makeLayer())),
    );

    const usage = events.find((e) => e.type === "usage") as
      | { type: "usage"; usage: { inputTokens?: number; outputTokens: number } }
      | undefined;
    expect(usage).toBeDefined();
    expect(usage!.usage.inputTokens).toBeUndefined();
    expect(usage!.usage.outputTokens).toBe(6);
  });

  it("stream(): no usageMetadata at all emits no usage event (not a measured 0/0)", async () => {
    streamChunks = [{ candidates: [{ content: { parts: [{ text: "4" }] } }] }];
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({ messages: [{ role: "user", content: "2+2?" }], model: MODEL });
        return Array.from(yield* Stream.runCollect(stream)) as StreamEvent[];
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(events.filter((e) => e.type === "usage")).toHaveLength(0);
  });
});
