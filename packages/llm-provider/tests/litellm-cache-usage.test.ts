// packages/llm-provider/tests/litellm-cache-usage.test.ts
// Cost-instrument truth (2026-08): litellm.ts's response usage type never
// declared a cache field, so cache-read counts LiteLLM normalizes to the
// OpenAI-shaped usage.prompt_tokens_details.cached_tokens (LiteLLM docs)
// could not be surfaced onto the returned usage object regardless of what
// the underlying proxied provider reported. Fixed by widening the response
// usage type and surfacing usage.cacheReadInputTokens (conditionally,
// mirroring anthropic.ts's idiom — absent means "not reported", never a
// false 0), for the non-streaming complete() path.
//
// Mocking convention mirrors litellm-dynamic-config.test.ts (mocks global
// fetch directly rather than an SDK module — litellm.ts talks HTTP, not SDK).
//
// Run: bun test packages/llm-provider/tests/litellm-cache-usage.test.ts --timeout 15000

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import type { LLMService as LLMServiceType } from "../src/index.js";

let mockUsage: Record<string, unknown> = {
  prompt_tokens: 10,
  completion_tokens: 5,
  total_tokens: 15,
};

// Streaming path: each test sets the `usage` field on the final SSE frame
// before [DONE].
let mockStreamUsage: Record<string, unknown> = {
  prompt_tokens: 10,
  completion_tokens: 5,
};

// SSE-encode frames (mirrors litellm-stream-tool-calls.test.ts's sseStream).
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
const mockFetch = (async (_url: unknown, opts?: unknown) => {
  const init = opts as { body?: string } | undefined;
  const body = init?.body ? (JSON.parse(init.body) as { stream?: boolean }) : undefined;

  if (body?.stream) {
    const frames = [
      JSON.stringify({
        choices: [{ delta: { content: "ok" }, finish_reason: null }],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: mockStreamUsage,
      }),
    ];
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      body: sseStream(frames),
      json: async () => ({}),
      text: async () => "",
    } as unknown as Response;
  }

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      choices: [{ message: { content: "ok", role: "assistant" }, finish_reason: "stop" }],
      usage: mockUsage,
      model: "proxied",
    }),
    text: async () => "",
  } as unknown as Response;
}) as typeof fetch;

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
  mockUsage = {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
  };
  mockStreamUsage = {
    prompt_tokens: 10,
    completion_tokens: 5,
  };
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

const complete = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* llm.complete({
        messages: [{ role: "user", content: "hello" }],
        model: "openai/gpt-4o-mini",
      });
    }).pipe(Effect.provide(makeLayer() as Layer.Layer<LLMServiceType, unknown>)),
  );

describe("LiteLLM cache-read usage surfacing (complete())", () => {
  it("surfaces cacheReadInputTokens in usage when reported (OpenAI-shaped prompt_tokens_details)", async () => {
    mockUsage = {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 6 },
    };
    const result = await complete();
    expect(result.usage.cacheReadInputTokens).toBe(6);
  });

  it("omits cacheReadInputTokens when no cache field is reported", async () => {
    mockUsage = {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    };
    const result = await complete();
    expect(result.usage.cacheReadInputTokens).toBeUndefined();
    expect("cacheReadInputTokens" in result.usage).toBe(false);
  });
});

const streamComplete = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const s = yield* llm.stream({
        messages: [{ role: "user", content: "hello" }],
        model: "openai/gpt-4o-mini",
      });
      return yield* Stream.runCollect(s);
    }).pipe(Effect.provide(makeLayer() as Layer.Layer<LLMServiceType, unknown>)),
  );

describe("LiteLLM cache-read usage surfacing (stream())", () => {
  it("surfaces cacheReadInputTokens on the streamed usage event when reported", async () => {
    mockStreamUsage = {
      prompt_tokens: 10,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 3 },
    };

    const events = await streamComplete();
    const usage = Array.from(events).find((e) => e.type === "usage") as
      | { type: "usage"; usage: Record<string, unknown> }
      | undefined;
    expect(usage).toBeDefined();
    expect(usage!.usage.cacheReadInputTokens).toBe(3);
  });

  it("omits cacheReadInputTokens on the streamed usage event when no cache field is reported", async () => {
    mockStreamUsage = {
      prompt_tokens: 10,
      completion_tokens: 5,
    };

    const events = await streamComplete();
    const usage = Array.from(events).find((e) => e.type === "usage") as
      | { type: "usage"; usage: Record<string, unknown> }
      | undefined;
    expect(usage).toBeDefined();
    expect(usage!.usage.cacheReadInputTokens).toBeUndefined();
    expect("cacheReadInputTokens" in usage!.usage).toBe(false);
  });
});
