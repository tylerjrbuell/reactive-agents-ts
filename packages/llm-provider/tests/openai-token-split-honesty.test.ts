// packages/llm-provider/tests/openai-token-split-honesty.test.ts
// Token-split honesty (2026-11): openai.ts reported `total_tokens ?? 0` on
// complete() and emitted a streamed usage event with inputTokens/outputTokens
// of 0 when no usage chunk arrived. Both read as MEASURED zeros. Fixed so an
// absent total falls back to input+output, and a stream that never reports
// usage emits NO usage event (no fabricated measurement).
//
// Run: bun test packages/llm-provider/tests/openai-token-split-honesty.test.ts --timeout 15000

import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

let mockUsage: Record<string, unknown> | undefined = {
  prompt_tokens: 10,
  completion_tokens: 5,
  total_tokens: 15,
};
// undefined = the stream never sends a usage chunk.
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
    ...(mockStreamUsage === undefined ? {} : { usage: mockStreamUsage }),
  };
}

const mockCreate = mock(async (opts: unknown) => {
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

describe("OpenAI total-token honesty (complete())", () => {
  it("falls back to input+output when total_tokens is absent (not 0)", async () => {
    mockUsage = { prompt_tokens: 10, completion_tokens: 5 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hi" }],
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(result.usage.totalTokens).toBe(15);
  });

  it("uses the reported total_tokens when present and positive", async () => {
    mockUsage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 18 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hi" }],
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(result.usage.totalTokens).toBe(18);
  });
});

describe("OpenAI stream usage honesty", () => {
  it("emits no usage event when the stream never sends a usage chunk", async () => {
    mockStreamUsage = undefined;

    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "hi" }],
        });
        return yield* Stream.runCollect(stream);
      }).pipe(Effect.provide(makeLayer())),
    );

    // A usage event here would claim measured 0/0 tokens. Absent = not reported.
    const usage = Array.from(events).filter((e) => e.type === "usage");
    expect(usage).toHaveLength(0);
  });
});

describe("OpenAI absent prompt/completion counts are unknown, not 0", () => {
  it("complete(): absent prompt_tokens and completion_tokens are undefined", async () => {
    mockUsage = { total_tokens: 15 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hi" }],
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(result.usage.inputTokens).toBeUndefined();
    expect(result.usage.outputTokens).toBeUndefined();
    expect(result.usage.totalTokens).toBe(15);
  });

  it("complete(): present zero prompt_tokens stays 0", async () => {
    mockUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hi" }],
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
  });

  it("stream(): partial usage keeps the absent half undefined, not derived", async () => {
    mockStreamUsage = { prompt_tokens: 10 };
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "hi" }],
        });
        return yield* Stream.runCollect(stream);
      }).pipe(Effect.provide(makeLayer())),
    );

    const usage = Array.from(events).find((e) => e.type === "usage");
    expect(usage?.type).toBe("usage");
    if (usage?.type !== "usage") throw new Error("expected usage");
    expect(usage.usage.inputTokens).toBe(10);
    expect(usage.usage.outputTokens).toBeUndefined();
  });
});
