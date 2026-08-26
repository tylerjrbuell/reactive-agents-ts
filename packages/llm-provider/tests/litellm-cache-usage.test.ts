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
import { Effect, Layer } from "effect";
import type { LLMService as LLMServiceType } from "../src/index.js";

let mockUsage: Record<string, unknown> = {
  prompt_tokens: 10,
  completion_tokens: 5,
  total_tokens: 15,
};

const originalFetch = globalThis.fetch;
const mockFetch = (async (_url: unknown, _opts?: unknown) => {
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

describe("LiteLLM cache-read usage surfacing", () => {
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
