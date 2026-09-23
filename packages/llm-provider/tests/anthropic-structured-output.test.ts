// packages/llm-provider/tests/anthropic-structured-output.test.ts
// Regression: completeStructured() built its JSON Schema string via
// Schema.encodedSchema(request.outputSchema), which returns another Effect
// Schema instance (not a JSON-serializable object). JSON.stringify() on it
// silently evaluated to `undefined`, and the downstream JSON.parse("undefined")
// threw "SyntaxError: JSON Parse error: Unexpected identifier undefined".
// Fixed by swapping in JSONSchema.make(), which returns a real
// JSON-Schema-shaped plain object.
//
// This test exercises the FULL completeStructured() pipeline (schema build +
// SDK call + parse) against a real Schema.Struct, matching the shape used by
// @reactive-agents/judgment's buildBatchSchema (`{ probability: number }`).
//
// Run: bun test packages/llm-provider/tests/anthropic-structured-output.test.ts --timeout 15000

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Schema } from "effect";

// Bun module mocks are process-global and leak across test FILES. Capture the
// real module and re-install it in afterAll so later files hit the real SDK
// again — mirrors anthropic-provider.test.ts.
const realAnthropicSdk = { ...(await import("@anthropic-ai/sdk")) };
afterAll(() => {
  mock.module("@anthropic-ai/sdk", () => realAnthropicSdk);
});

// ─── Mock @anthropic-ai/sdk BEFORE the provider module is imported ───

let capturedCreateOpts: Record<string, unknown> | null = null;

const mockCreate = mock(async (opts: unknown) => {
  capturedCreateOpts = opts as Record<string, unknown>;
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    // completeStructured() prefills the assistant turn with "{" and prepends
    // it back onto the response content — see anthropic.ts:578.
    content: [{ type: "text", text: '"probability": 0.87}' }],
    model: "claude-opus-4-8",
    stop_reason: "end_turn",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
    },
  };
});

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
    };
  },
}));

// ─── Lazy imports (after mock registration) ───

import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";

let AnthropicProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMService: typeof import("../src/index.js")["LLMService"];
let LLMConfig: typeof import("../src/index.js")["LLMConfig"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  AnthropicProviderLive = mod.AnthropicProviderLive;
  LLMService = mod.LLMService;
  LLMConfig = mod.LLMConfig;
});

const ProbabilitySchema = Schema.Struct({ probability: Schema.Number });

function makeLayer() {
  return Layer.provide(
    AnthropicProviderLive,
    Layer.succeed(
      LLMConfig,
      LLMConfig.of({
        defaultProvider: "anthropic",
        defaultModel: "claude-opus-4-8",
        anthropicApiKey: "test-key",
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

describe("AnthropicProviderLive completeStructured() — schema build regression", () => {
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
    expect(mockCreate).toHaveBeenCalled();

    // Regression proper: Schema.encodedSchema(request.outputSchema) resolves
    // to a non-serializable Effect Schema instance, so
    // JSON.stringify(...) on it silently produced the literal string
    // "undefined" in the instruction prompt sent to the model — the model
    // never saw the real field names/types. Assert the actual schema shape
    // reached the wire, not the word "undefined".
    const messages = capturedCreateOpts?.messages as
      | Array<{ role: string; content: unknown }>
      | undefined;
    // Last message is the "{" assistant prefill (anthropic.ts pushes it
    // after the schema instruction) — the schema instruction is the one
    // before it.
    const lastUserMessage = messages?.[messages.length - 2];
    const promptText =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage?.content);

    expect(promptText).toContain("probability");
    expect(promptText).not.toContain("undefined");
  });
});
