// Run: bun test packages/llm-provider/tests/openai-nonok-guard.test.ts --timeout 15000
//
// Cluster B parity: OpenAI must surface a non-OK finish_reason (length /
// content_filter) with no content as an explicit error, instead of silently
// returning an empty-success.
import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

// Non-OK, empty stream chunk so the stream-path guard exercises.
async function* nonOkStream() {
  yield {
    choices: [{ delta: { content: "" }, finish_reason: "length" }],
    usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
  };
}

const mockCreate = mock(async (opts: { stream?: boolean }) => {
  if (opts?.stream) return nonOkStream();
  return {
    id: "chatcmpl_test",
    model: "gpt-4o",
    choices: [
      {
        message: { role: "assistant", content: "", tool_calls: undefined },
        finish_reason: "length", // non-OK: truncated before any output
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
  };
});

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";

let OpenAIProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMService: (typeof import("../src/index.js"))["LLMService"];
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  OpenAIProviderLive = mod.OpenAIProviderLive;
  LLMService = mod.LLMService;
  LLMConfig = mod.LLMConfig;
});

function makeLayer() {
  const configLayer = Layer.succeed(LLMConfig, {
    provider: "openai" as const,
    openaiApiKey: "test-key",
    defaultModel: "gpt-4o",
    defaultMaxTokens: 1024,
    defaultTemperature: 0.5,
    pricingRegistry: undefined,
  });
  return Layer.provide(OpenAIProviderLive, configLayer);
}

describe("OpenAI non-OK finish guard (Cluster B)", () => {
  it("fails with LLMError when finish_reason=length and content is empty", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hi" }],
        });
      }).pipe(Effect.provide(makeLayer()), Effect.flip),
    );

    expect((error as { _tag?: string })._tag).toBe("LLMError");
    expect(String((error as { message?: string }).message)).toContain("length");
  }, 15000);

  it("stream() fails with LLMError when finish_reason=length with empty content", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "hi" }],
        });
        return yield* Stream.runDrain(stream);
      }).pipe(Effect.provide(makeLayer()), Effect.flip),
    );

    expect((error as { _tag?: string })._tag).toBe("LLMError");
    expect(String((error as { message?: string }).message)).toContain("length");
  }, 15000);
});
