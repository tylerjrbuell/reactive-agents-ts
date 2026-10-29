// Run: bun test packages/llm-provider/tests/litellm-reasoning-temperature.test.ts
//
// OpenAI reasoning ids (gpt-5*, o<digit>) 400 on non-default temperature.
// openai.ts omits it (buildTemperatureField); litellm must do the same, also
// when the id is provider-prefixed (openai/gpt-5-mini) — complete/stream/structured.

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import type { LLMService as LLMServiceType } from "../src/index.js";

let lastRequestBody: Record<string, unknown> | undefined;
const originalFetch = globalThis.fetch;
const mockFetch = (async (_url: unknown, opts?: unknown) => {
  const init = opts as { body?: string } | undefined;
  if (init?.body) lastRequestBody = JSON.parse(init.body) as Record<string, unknown>;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      choices: [{ message: { content: '{"a":1}', role: "assistant" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      model: "proxied",
    }),
    text: async () => "",
    body: new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(
          enc.encode(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            })}\n\n`,
          ),
        );
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
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
  lastRequestBody = undefined;
});

const layer = () =>
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
        }),
      ),
    ),
  );

const run = (model: string, path: "complete" | "stream" | "structured") =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const req = { messages: [{ role: "user" as const, content: "hello" }], model: { provider: "litellm" as const, model } };
      if (path === "complete") yield* llm.complete({ ...req, model: req.model });
      else if (path === "stream") {
        const s = yield* llm.stream(req);
        yield* Stream.runCollect(s);
      } else {
        const { Schema } = yield* Effect.promise(() => import("effect"));
        yield* llm.completeStructured({
          ...req,
          outputSchema: Schema.Struct({ a: Schema.Number }),
        });
      }
    }).pipe(Effect.provide(layer() as Layer.Layer<LLMServiceType, unknown>)),
  );

describe("LiteLLM omits temperature for OpenAI reasoning ids", () => {
  for (const path of ["complete", "stream", "structured"] as const) {
    for (const model of ["gpt-5-mini", "openai/gpt-5-mini", "o3", "openai/o4-mini"]) {
      it(`${path}: ${model} omits temperature`, async () => {
        await run(model, path);
        expect(lastRequestBody).toBeDefined();
        expect(lastRequestBody?.temperature).toBeUndefined();
      });
    }
    for (const model of ["gpt-4o", "claude-3-5-sonnet", "openai/gpt-4o-mini"]) {
      it(`${path}: ${model} keeps temperature`, async () => {
        await run(model, path);
        expect(lastRequestBody?.temperature).toBe(0.7);
      });
    }
  }
});
