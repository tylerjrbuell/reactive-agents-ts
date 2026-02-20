import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

// ─── Mock @google/genai BEFORE the provider module is imported ───
// Uses mock.module to intercept dynamic import("@google/genai") in gemini.ts

const mockGenerateContent = mock(async (_opts: unknown) => ({
  text: "Gemini mock response",
  functionCalls: undefined as Array<{ name: string; args: unknown }> | undefined,
  usageMetadata: {
    promptTokenCount: 12,
    candidatesTokenCount: 8,
    totalTokenCount: 20,
  },
}));

const mockEmbedContent = mock(async (_opts: unknown) => ({
  embeddings: [
    { values: [0.1, 0.2, 0.3, 0.4] },
    { values: [0.5, 0.6, 0.7, 0.8] },
  ],
}));

async function* mockStreamGenerator() {
  yield { text: "Hello", usageMetadata: undefined };
  yield {
    text: " World",
    usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 4 },
  };
}
const mockGenerateContentStream = mock(
  async (_opts: unknown) => mockStreamGenerator(),
);

mock.module("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
      embedContent: mockEmbedContent,
    };
  },
}));

// ─── Types (imported at top level via static import) ───
import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";

// Lazily resolved after mock registration
let GeminiProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  // Dynamic import ensures mock is in place when gemini.ts first calls import("@google/genai")
  const mod = await import("../src/index.js");
  GeminiProviderLive = mod.GeminiProviderLive as EffectLayer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

// ─── Test helper ───

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

// ─── Tests ───

describe("GeminiProviderLive", () => {
  it("complete() returns mapped CompletionResponse", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Say hello" }],
        });
      }),
    );

    expect(result.content).toBe("Gemini mock response");
    expect(result.stopReason).toBe("end_turn");
    expect(result.model).toBe("gemini-2.0-flash");
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.outputTokens).toBe(8);
    expect(result.usage.totalTokens).toBe(20);
  });

  it("complete() passes system instruction via config", async () => {
    await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Hello" },
          ],
        });
      }),
    );

    const callArgs = mockGenerateContent.mock.calls.at(-1)?.[0] as {
      config: { systemInstruction?: string };
    };
    expect(callArgs.config.systemInstruction).toBe(
      "You are a helpful assistant.",
    );
  });

  it("complete() excludes system messages from contents array", async () => {
    await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [
            { role: "system", content: "Be concise." },
            { role: "user", content: "Hi" },
          ],
        });
      }),
    );

    const callArgs = mockGenerateContent.mock.calls.at(-1)?.[0] as {
      contents: Array<{ role: string }>;
    };
    const roles = callArgs.contents.map((c) => c.role);
    expect(roles).not.toContain("system");
    expect(roles).toContain("user");
  });

  it("complete() maps assistant role to model role", async () => {
    await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [
            { role: "user", content: "Question" },
            { role: "assistant", content: "Answer" },
            { role: "user", content: "Follow-up" },
          ],
        });
      }),
    );

    const callArgs = mockGenerateContent.mock.calls.at(-1)?.[0] as {
      contents: Array<{ role: string }>;
    };
    const roles = callArgs.contents.map((c) => c.role);
    expect(roles).toEqual(["user", "model", "user"]);
  });

  it("stream() emits text deltas and content_complete", async () => {
    const events = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "Stream test" }],
        });
        return yield* Stream.runCollect(stream);
      }),
    );

    const arr = Array.from(events);
    const textDeltas = arr.filter((e) => e.type === "text_delta");
    const complete = arr.find((e) => e.type === "content_complete");
    const usage = arr.find((e) => e.type === "usage");

    expect(textDeltas.length).toBe(2);
    expect((textDeltas[0] as { type: "text_delta"; text: string }).text).toBe(
      "Hello",
    );
    expect(complete).toBeDefined();
    expect(
      (complete as { type: "content_complete"; content: string }).content,
    ).toBe("Hello World");
    expect(usage).toBeDefined();
  });

  it("embed() returns embeddings for each text", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.embed(["text one", "text two"]);
      }),
    );

    expect(result.length).toBe(2);
    expect(result[0]).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(result[1]).toEqual([0.5, 0.6, 0.7, 0.8]);
  });

  it("countTokens() returns positive number", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.countTokens([
          { role: "user", content: "Hello world" },
        ]);
      }),
    );

    expect(result).toBeGreaterThan(0);
  });

  it("getModelConfig() returns gemini provider and model", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.getModelConfig();
      }),
    );

    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-2.0-flash");
  });

  it("complete() with function calling returns tool_use stopReason", async () => {
    mockGenerateContent.mockImplementationOnce(async (_opts: unknown) => ({
      text: "",
      functionCalls: [{ name: "search", args: { query: "test" } }],
      usageMetadata: {
        promptTokenCount: 5,
        candidatesTokenCount: 3,
        totalTokenCount: 8,
      },
    }));

    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Search for test" }],
          tools: [
            {
              name: "search",
              description: "Search the web",
              inputSchema: { properties: { query: { type: "string" } } },
            },
          ],
        });
      }),
    );

    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls?.length).toBe(1);
    expect(result.toolCalls?.[0]?.name).toBe("search");
  });
});
