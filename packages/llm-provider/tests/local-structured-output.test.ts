// packages/llm-provider/tests/local-structured-output.test.ts
// Regression: completeStructured() built its JSON Schema string via
// Schema.encodedSchema(request.outputSchema), which returns another Effect
// Schema instance (not a JSON-serializable object). JSON.stringify() on it
// silently evaluated to `undefined`, and the downstream JSON.parse("undefined")
// threw "SyntaxError: JSON Parse error: Unexpected identifier undefined" —
// reproduced live via scratch.ts against a real Ollama provider using the
// judgment layer's 'llm' emulation backend. Fixed by swapping in
// JSONSchema.make(), which returns a real JSON-Schema-shaped plain object.
//
// This test exercises the FULL completeStructured() pipeline (schema build +
// SDK call + parse) against a real Schema.Struct, matching the shape used by
// @reactive-agents/judgment's buildBatchSchema (`{ probability: number }`).
//
// Run: bun test packages/llm-provider/tests/local-structured-output.test.ts --timeout 15000

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Schema } from "effect";

// ─── Mock the `ollama` package BEFORE provider module is imported ───
const realOllamaModule = { ...(await import("ollama")) };
afterAll(() => {
  mock.module("ollama", () => realOllamaModule);
});

const mockChat = mock(async (_opts: unknown) => ({
  model: "cogito:14b",
  message: {
    role: "assistant",
    content: JSON.stringify({ probability: 0.87 }),
    tool_calls: undefined,
  },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 10,
  eval_count: 5,
}));

mock.module("ollama", () => ({
  Ollama: class MockOllama {
    constructor(_opts?: { host?: string }) {}
    chat = mockChat;
    embed = mock(async () => ({ embeddings: [] }));
    show = mock(async (_opts: { model: string }) => ({
      template: "default template without thinking",
    }));
  },
}));

// ─── Lazily resolved imports ───
import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";

let LocalProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  LocalProviderLive = mod.LocalProviderLive as EffectLayer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

const ProbabilitySchema = Schema.Struct({ probability: Schema.Number });

const makeTestLayer = () => {
  const testConfig = LLMConfig.of({
    defaultProvider: "ollama",
    defaultModel: "cogito:14b",
    ollamaEndpoint: "http://localhost:11434",
    embeddingConfig: {
      model: "nomic-embed-text",
      dimensions: 3,
      provider: "ollama",
      batchSize: 100,
    },
    supportsPromptCaching: false,
    maxRetries: 1,
    timeoutMs: 30_000,
    defaultMaxTokens: 1024,
    defaultTemperature: 0.7,
  });

  return LocalProviderLive.pipe(
    Layer.provide(Layer.succeed(LLMConfig, testConfig)),
  );
};

const run = <A>(effect: Effect.Effect<A, unknown, LLMServiceType>) => {
  const layer = makeTestLayer();
  return Effect.runPromise(
    effect.pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
  );
};

describe("OllamaProviderLive completeStructured() — schema build regression", () => {
  it("builds a valid JSON schema string and does not throw (JSONSchema.make regression)", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.completeStructured({
          messages: [{ role: "user", content: "Give me a probability." }],
          outputSchema: ProbabilitySchema,
        });
      }),
    );

    expect(result).toEqual({ probability: 0.87 });
    expect(mockChat).toHaveBeenCalled();
  });
});
