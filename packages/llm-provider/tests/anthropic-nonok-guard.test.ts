// Run: bun test packages/llm-provider/tests/anthropic-nonok-guard.test.ts --timeout 15000
//
// Cluster B parity: Anthropic must surface a non-OK stop_reason with no content
// as an explicit error (like gemini.ts does), instead of silently returning an
// empty-success the agent can't distinguish from "model finished early".
import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

// Bun module mocks are process-global and leak across test FILES. Capture the
// real module and re-install it in afterAll so later files (e.g. runtime
// live-Anthropic tests) hit the real SDK again.
const realAnthropicSdk = { ...(await import("@anthropic-ai/sdk")) };
afterAll(() => {
  mock.module("@anthropic-ai/sdk", () => realAnthropicSdk);
});

const NON_OK_FINAL = {
  id: "msg_test",
  type: "message",
  role: "assistant",
  content: [] as Array<{ type: string; text?: string }>, // empty — model emitted nothing visible
  model: "claude-sonnet-4-6",
  stop_reason: "max_tokens", // non-OK: budget exhausted before any output
  usage: { input_tokens: 10, output_tokens: 0 },
};

const mockCreate = mock(async () => NON_OK_FINAL);

// Stream mock that fires a non-OK, empty finalMessage so the stream-path guard exercises.
const makeMockStream = () => {
  const obj: { on: (event: string, cb: (m: unknown) => void) => unknown } = {
    on(event, cb) {
      if (event === "finalMessage") setTimeout(() => cb(NON_OK_FINAL), 0);
      return obj;
    },
  };
  return obj;
};

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
      stream: () => makeMockStream(),
    };
  },
}));

import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";

let AnthropicProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMService: (typeof import("../src/index.js"))["LLMService"];
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  AnthropicProviderLive = mod.AnthropicProviderLive;
  LLMService = mod.LLMService;
  LLMConfig = mod.LLMConfig;
});

function makeLayer() {
  const configLayer = Layer.succeed(LLMConfig, {
    provider: "anthropic" as const,
    apiKey: "test-key",
    defaultModel: "claude-sonnet-4-6",
    defaultMaxTokens: 1024,
    defaultTemperature: 0.5,
    pricingRegistry: undefined,
  });
  return Layer.provide(AnthropicProviderLive, configLayer);
}

describe("Anthropic non-OK stop guard (Cluster B)", () => {
  it("fails with LLMError when stop_reason=max_tokens and content is empty", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hi" }],
        });
      }).pipe(Effect.provide(makeLayer()), Effect.flip),
    );

    expect((error as { _tag?: string })._tag).toBe("LLMError");
    expect(String((error as { message?: string }).message)).toContain("max_tokens");
  }, 15000);

  it("stream() fails with LLMError when finalMessage is non-OK with empty content", async () => {
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
    expect(String((error as { message?: string }).message)).toContain("max_tokens");
  }, 15000);
});
