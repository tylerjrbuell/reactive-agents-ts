// packages/llm-provider/tests/litellm-structured-output.test.ts
// Regression: completeStructured() built its JSON Schema string via
// Schema.encodedSchema(request.outputSchema), which returns another Effect
// Schema instance (not a JSON-serializable object). JSON.stringify() on it
// silently evaluated to `undefined`, and the downstream JSON.parse("undefined")
// threw "SyntaxError: JSON Parse error: Unexpected identifier undefined".
// Fixed by swapping in JSONSchema.make(), which returns a real
// JSON-Schema-shaped plain object.
//
// This test exercises the FULL completeStructured() pipeline (schema build +
// fetch call + parse) against a real Schema.Struct, matching the shape used
// by @reactive-agents/judgment's buildBatchSchema (`{ probability: number }`).
//
// Run: bun test packages/llm-provider/tests/litellm-structured-output.test.ts --timeout 15000

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import type { LLMService as LLMServiceType } from "../src/index.js";

let capturedBody: Record<string, unknown> | null = null;

const originalFetch = globalThis.fetch;
const mockFetch = (async (_url: unknown, opts?: unknown) => {
  const init = opts as { body?: string } | undefined;
  capturedBody = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({ probability: 0.87 }),
            role: "assistant",
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: "proxied",
    }),
    text: async () => "",
  } as unknown as Response;
}) as typeof fetch;

let LiteLLMProviderLive: Layer.Layer<LLMServiceType>;
let LLMService: (typeof import("../src/index.js"))["LLMService"];
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];

beforeAll(async () => {
  globalThis.fetch = mockFetch;
  const mod = await import("../src/index.js");
  LiteLLMProviderLive = mod.LiteLLMProviderLive as Layer.Layer<LLMServiceType>;
  LLMService = mod.LLMService;
  LLMConfig = mod.LLMConfig;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const ProbabilitySchema = Schema.Struct({ probability: Schema.Number });

function makeLayer() {
  return Layer.provide(
    LiteLLMProviderLive,
    Layer.succeed(
      LLMConfig,
      LLMConfig.of({
        defaultProvider: "litellm",
        defaultModel: "openai/gpt-4o-mini",
        litellmBaseUrl: "http://localhost:4000",
        litellmApiKey: "test-key",
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

describe("LiteLLMProviderLive completeStructured() — schema build regression", () => {
  it("builds a valid JSON schema string and does not throw (JSONSchema.make regression)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.completeStructured({
          messages: [{ role: "user", content: "Give me a probability." }],
          outputSchema: ProbabilitySchema,
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(result).toEqual({ probability: 0.87 });

    // Regression proper: Schema.encodedSchema(request.outputSchema) resolves
    // to a non-serializable Effect Schema instance, so
    // JSON.stringify(...) on it silently produced the literal string
    // "undefined" in the instruction prompt sent to the model — the model
    // never saw the real field names/types. Assert the actual schema shape
    // reached the wire, not the word "undefined".
    const messages = capturedBody?.messages as
      | Array<{ role: string; content: unknown }>
      | undefined;
    const lastUserMessage = messages?.[messages.length - 1];
    const promptText =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage?.content);

    expect(promptText).toContain("probability");
    expect(promptText).not.toContain("undefined");
  });
});
