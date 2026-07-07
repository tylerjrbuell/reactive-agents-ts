// Run: bun test packages/llm-provider/tests/cloud-timeout-wiring.test.ts
//
// F4 wiring — cloud complete() honors the resolveCloudTimeoutMs chain
// end-to-end: request.timeoutMs (top of chain) drives BOTH the Effect.timeout
// ceiling and the timeoutMs restated in the LLMTimeoutError, from one
// binding. Exercised through litellm (fetch-based → easiest to stall);
// anthropic/openai/gemini use the identical helper + pipe shape.

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Either } from "effect";
import type { LLMService as LLMServiceType } from "../src/index.js";

// A fetch that never resolves — forces the timeout path.
const originalFetch = globalThis.fetch;
const stallingFetch = (async () =>
  new Promise<Response>(() => {
    /* never resolves */
  })) as unknown as typeof fetch;

let LiteLLMProviderLive: Layer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  globalThis.fetch = stallingFetch;
  const mod = await import("../src/index.js");
  LiteLLMProviderLive = mod.LiteLLMProviderLive as Layer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const makeLayer = (cloudTimeoutMs?: number) =>
  LiteLLMProviderLive.pipe(
    Layer.provide(
      Layer.succeed(
        LLMConfig,
        LLMConfig.of({
          defaultProvider: "litellm",
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
          observabilityVerbosity: "full",
          ...(cloudTimeoutMs !== undefined ? { cloudTimeoutMs } : {}),
        }),
      ),
    ),
  );

const completeEither = (
  layer: Layer.Layer<LLMServiceType>,
  timeoutMs?: number,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* Effect.either(
        llm.complete({
          messages: [{ role: "user", content: "hello" }],
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        }),
      );
    }).pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
  );

describe("F4 — cloud timeout resolution chain (via litellm)", () => {
  it("request.timeoutMs drives the ceiling AND the error's timeoutMs field", async () => {
    const result = await completeEither(makeLayer(), 50);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const err = result.left as { _tag: string; timeoutMs: number; provider: string };
      expect(err._tag).toBe("LLMTimeoutError");
      expect(err.timeoutMs).toBe(50);
      expect(err.provider).toBe("litellm");
    }
  }, 10_000);

  it("config.cloudTimeoutMs is used when the request has no override", async () => {
    const result = await completeEither(makeLayer(80));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const err = result.left as { _tag: string; timeoutMs: number };
      expect(err._tag).toBe("LLMTimeoutError");
      expect(err.timeoutMs).toBe(80);
    }
  }, 10_000);
});
