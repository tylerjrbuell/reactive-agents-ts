// Run: bun test packages/llm-provider/tests/litellm-dynamic-config.test.ts
//
// #198 — dynamic OpenAI-compatible provider config (baseUrl/apiKey/headers) at
// runtime instead of predefined env vars, so `litellm` can point at a
// llama.cpp server, Deepseek, or any other OpenAI-compatible endpoint.
// `litellmBaseUrl`/`litellmApiKey` previously lived on LLMConfig only via an
// `as unknown as {...}` cast (untyped); `litellmHeaders` didn't exist at all.

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import type { LLMService as LLMServiceType } from "../src/index.js";

let lastUrl: string | undefined;
let lastHeaders: Record<string, string> | undefined;

const originalFetch = globalThis.fetch;
const mockFetch = (async (url: unknown, opts?: unknown) => {
  lastUrl = String(url);
  const init = opts as { headers?: Record<string, string> } | undefined;
  lastHeaders = init?.headers;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      choices: [{ message: { content: "ok", role: "assistant" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      model: "proxied",
    }),
    text: async () => "",
  } as unknown as Response;
}) as typeof fetch;

let LiteLLMProviderLive: Layer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];
let createLLMProviderLayer: (typeof import("../src/index.js"))["createLLMProviderLayer"];

beforeAll(async () => {
  globalThis.fetch = mockFetch;
  const mod = await import("../src/index.js");
  LiteLLMProviderLive = mod.LiteLLMProviderLive as Layer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
  createLLMProviderLayer = mod.createLLMProviderLayer;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  lastUrl = undefined;
  lastHeaders = undefined;
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
  observabilityVerbosity: "full" as const,
};

const complete = (layer: Layer.Layer<LLMServiceType>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* llm.complete({
        messages: [{ role: "user", content: "hello" }],
        model: "openai/gpt-4o-mini",
      });
    }).pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
  );

describe("litellm dynamic provider config (#198)", () => {
  it("LLMConfig.litellmBaseUrl/litellmHeaders route the request to a custom OpenAI-compatible endpoint", async () => {
    const layer = LiteLLMProviderLive.pipe(
      Layer.provide(
        Layer.succeed(
          LLMConfig,
          LLMConfig.of({
            ...baseConfig,
            litellmBaseUrl: "http://localhost:8080/v1",
            litellmApiKey: "sk-local",
            litellmHeaders: { "X-Custom": "value" },
          }),
        ),
      ),
    );

    await complete(layer);

    expect(lastUrl).toBe("http://localhost:8080/v1/chat/completions");
    expect(lastHeaders?.["Authorization"]).toBe("Bearer sk-local");
    expect(lastHeaders?.["X-Custom"]).toBe("value");
  });

  it("LLMConfig.providerConfig takes precedence over litellmBaseUrl/litellmApiKey/litellmHeaders", async () => {
    const layer = LiteLLMProviderLive.pipe(
      Layer.provide(
        Layer.succeed(
          LLMConfig,
          LLMConfig.of({
            ...baseConfig,
            litellmBaseUrl: "http://old-env-style:4000",
            litellmApiKey: "sk-old",
            litellmHeaders: { "X-Old": "yes" },
            providerConfig: {
              baseUrl: "http://localhost:8080/v1",
              apiKey: "sk-local",
              headers: { "X-Custom": "value" },
            },
          }),
        ),
      ),
    );

    await complete(layer);

    expect(lastUrl).toBe("http://localhost:8080/v1/chat/completions");
    expect(lastHeaders?.["Authorization"]).toBe("Bearer sk-local");
    expect(lastHeaders?.["X-Custom"]).toBe("value");
    expect(lastHeaders?.["X-Old"]).toBeUndefined();
  });

  it("createLLMProviderLayer's modelParams.baseUrl/apiKey/headers map onto LLMConfig.providerConfig", async () => {
    const layer = createLLMProviderLayer("litellm", undefined, undefined, {
      baseUrl: "http://localhost:9090/v1",
      apiKey: "sk-runtime",
      headers: { "X-Runtime": "yes" },
    }) as Layer.Layer<LLMServiceType>;

    await complete(layer);

    expect(lastUrl).toBe("http://localhost:9090/v1/chat/completions");
    expect(lastHeaders?.["Authorization"]).toBe("Bearer sk-runtime");
    expect(lastHeaders?.["X-Runtime"]).toBe("yes");
  });
});
