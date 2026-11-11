// packages/llm-provider/tests/litellm-token-split-honesty.test.ts
// Token-split honesty (2026-11): litellm.ts reported `total_tokens ?? 0` on
// complete() and emitted a streamed usage event with inputTokens/outputTokens
// of 0 when the proxy sent no usage. Both read as MEASURED zeros. Fixed so an
// absent total falls back to input+output, and a stream without usage emits
// NO usage event.
//
// Mocking convention mirrors litellm-cache-usage.test.ts (global fetch stub).
//
// Run: bun test packages/llm-provider/tests/litellm-token-split-honesty.test.ts --timeout 15000

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { fetchStub } from "./helpers/fetch-stub.js";
import { Effect, Layer, Stream } from "effect";
import type { LLMService as LLMServiceType } from "../src/index.js";

let mockUsage: Record<string, unknown> | undefined = {
  prompt_tokens: 10,
  completion_tokens: 5,
  total_tokens: 15,
};
// undefined = the proxy never attaches usage to the stream.
let mockStreamUsage: Record<string, unknown> | undefined = {
  prompt_tokens: 10,
  completion_tokens: 5,
};

const sseStream = (frames: ReadonlyArray<string>): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
};

const originalFetch = globalThis.fetch;
const mockFetch = fetchStub(async (_url, init) => {
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { stream?: boolean }) : undefined;

  if (body?.stream) {
    const finalFrame: Record<string, unknown> = {
      choices: [{ delta: {}, finish_reason: "stop" }],
    };
    if (mockStreamUsage !== undefined) finalFrame.usage = mockStreamUsage;
    const frames = [
      JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: null }] }),
      JSON.stringify(finalFrame),
    ];
    return new Response(sseStream(frames), { status: 200, statusText: "OK" });
  }

  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "ok", role: "assistant" }, finish_reason: "stop" }],
      ...(mockUsage === undefined ? {} : { usage: mockUsage }),
      model: "proxied",
    }),
    { status: 200, statusText: "OK" },
  );
});

let LiteLLMProviderLive: Layer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  globalThis.fetch = mockFetch;
  const mod = await import("../src/index.js");
  LiteLLMProviderLive = mod.LiteLLMProviderLive as Layer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  mockUsage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  mockStreamUsage = { prompt_tokens: 10, completion_tokens: 5 };
});

const baseConfig = {
  defaultProvider: "litellm" as const,
  defaultModel: "openai/gpt-4o-mini",
  embeddingConfig: {
    model: "text-embedding-3-small",
    dimensions: 3,
    provider: "openai" as const,
    batchSize: 100,
  },
  supportsPromptCaching: false,
  maxRetries: 1,
  timeoutMs: 30_000,
  defaultMaxTokens: 1024,
  defaultTemperature: 0.7,
};

const makeLayer = () =>
  LiteLLMProviderLive.pipe(Layer.provide(Layer.succeed(LLMConfig, baseConfig)));

describe("LiteLLM total-token honesty (complete())", () => {
  it("falls back to input+output when total_tokens is absent (not 0)", async () => {
    mockUsage = { prompt_tokens: 10, completion_tokens: 5 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hello" }],
          model: "openai/gpt-4o-mini",
        });
      }).pipe(Effect.provide(makeLayer() as Layer.Layer<LLMServiceType, unknown>)),
    );

    expect(result.usage.totalTokens).toBe(15);
  });
});

describe("LiteLLM stream usage honesty", () => {
  it("emits no usage event when the proxy never sends usage", async () => {
    mockStreamUsage = undefined;
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "hello" }],
          model: "openai/gpt-4o-mini",
        });
        return yield* Stream.runCollect(stream);
      }).pipe(Effect.provide(makeLayer() as Layer.Layer<LLMServiceType, unknown>)),
    );

    // A usage event here would claim measured 0/0 tokens. Absent = not reported.
    expect(Array.from(events).filter((e) => e.type === "usage")).toHaveLength(0);
  });
});

describe("LiteLLM absent prompt/completion counts are unknown, not 0", () => {
  it("complete(): absent prompt_tokens and completion_tokens are undefined", async () => {
    mockUsage = { total_tokens: 15 };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hello" }],
          model: "openai/gpt-4o-mini",
        });
      }).pipe(Effect.provide(makeLayer() as Layer.Layer<LLMServiceType, unknown>)),
    );

    expect(result.usage.inputTokens).toBeUndefined();
    expect(result.usage.outputTokens).toBeUndefined();
    expect(result.usage.totalTokens).toBe(15);
  });

  it("stream(): partial usage keeps the absent half undefined, not derived", async () => {
    mockStreamUsage = { prompt_tokens: 10 };
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "hello" }],
          model: "openai/gpt-4o-mini",
        });
        return yield* Stream.runCollect(stream);
      }).pipe(Effect.provide(makeLayer() as Layer.Layer<LLMServiceType, unknown>)),
    );

    const usage = Array.from(events).find((e) => e.type === "usage");
    if (usage?.type !== "usage") throw new Error("expected usage");
    expect(usage.usage.inputTokens).toBe(10);
    expect(usage.usage.outputTokens).toBeUndefined();
  });
});
