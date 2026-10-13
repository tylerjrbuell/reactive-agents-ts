// Run: bun test packages/llm-provider/tests/anthropic-stream-thinking.test.ts --timeout 15000
//
// Wave 1.2 audit — anthropic extended-thinking blocks now route through the
// SAME `thinking_delta` StreamEvent the local (Ollama) provider emits, gated
// by the existing `resolveThinkingEnabled` capability seam (opt-in only).
// Before this, `content_block_delta` events with delta type "thinking_delta"
// were silently dropped by the streamEvent handler.

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

const realAnthropicSdk = { ...(await import("@anthropic-ai/sdk")) };
afterAll(() => {
  mock.module("@anthropic-ai/sdk", () => realAnthropicSdk);
});

// Raw streamEvents the fake SDK stream fires once the provider registers
// handlers (sequence mirrors a real extended-thinking response).
let pendingEvents: unknown[] = [];

const mockStream = mock((_opts: unknown) => {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  queueMicrotask(() => {
    for (const ev of pendingEvents) handlers.streamEvent?.(ev);
    handlers.finalMessage?.({
      content: [
        { type: "thinking", thinking: "Let me think. ", signature: "sig_test" },
        { type: "text", text: "The answer is 4." },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 8 },
      model: "claude-sonnet-4-5",
    });
  });
  return {
    on: (ev: string, cb: (...a: unknown[]) => void) => {
      handlers[ev] = cb;
    },
  };
});

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: async () => ({ content: [], usage: {} }),
      stream: mockStream,
    };
  },
}));

import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";
import type { StreamEvent } from "../src/types.js";

let AnthropicProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMService: typeof import("../src/index.js")["LLMService"];
let LLMConfig: typeof import("../src/index.js")["LLMConfig"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  AnthropicProviderLive = mod.AnthropicProviderLive;
  LLMService = mod.LLMService;
  LLMConfig = mod.LLMConfig;
});

const makeLayer = (model: string, thinking?: boolean) =>
  Layer.provide(
    AnthropicProviderLive,
    Layer.succeed(
      LLMConfig,
      {
        defaultProvider: "anthropic",
        defaultModel: model,
        anthropicApiKey: "test-key",
        timeoutMs: 30_000,
        maxRetries: 0,
        defaultMaxTokens: 128,
        defaultTemperature: 0.1,
        pricingRegistry: {},
        supportsPromptCaching: false,
        embeddingConfig: { model: "", dimensions: 1, provider: "openai" as never },
        ...(thinking === undefined ? {} : { thinking }),
      } as unknown as LLMConfig["Type"],
    ),
  );

const collect = (model: string, thinking?: boolean): Promise<StreamEvent[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const stream = yield* llm.stream({
        messages: [{ role: "user", content: "2+2?" }],
        model,
      });
      return Array.from(yield* Stream.runCollect(stream));
    }).pipe(Effect.provide(makeLayer(model, thinking))),
  );

describe("anthropic stream — thinking_delta routing (Wave 1.2)", () => {
  it("emits thinking_delta events + content_complete.thinking when thinking is opted in on a capable model", async () => {
    pendingEvents = [
      { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me " } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "think. " } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig_test" } },
      { type: "content_block_start", index: 1, content_block: { type: "text" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "The answer is 4." } },
    ];

    const events = await collect("claude-sonnet-4-5", true);

    const thinkingDeltas = events.filter((e) => e.type === "thinking_delta");
    expect(thinkingDeltas.length).toBe(2);
    if (thinkingDeltas[0]?.type !== "thinking_delta") throw new Error("expected thinking_delta");
    expect(thinkingDeltas[0].thinking).toBe("Let me ");

    const complete = events.find((e) => e.type === "content_complete");
    if (complete?.type !== "content_complete") throw new Error("expected content_complete");
    expect(complete.content).toBe("The answer is 4.");
    expect(complete.thinking).toBe("Let me think. ");
  }, 15000);

  it("emits ZERO thinking_delta when thinking is not opted in (undefined → off)", async () => {
    pendingEvents = [
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hidden" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "visible" } },
    ];

    const events = await collect("claude-sonnet-4-5", undefined);

    expect(events.filter((e) => e.type === "thinking_delta").length).toBe(0);
    const complete = events.find((e) => e.type === "content_complete");
    if (complete?.type !== "content_complete") throw new Error("expected content_complete");
    expect((complete as { thinking?: string }).thinking).toBeUndefined();
  }, 15000);

  it("emits ZERO thinking_delta on an incapable model even with thinking:true (capability seam degrades)", async () => {
    pendingEvents = [
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "nope" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hi" } },
    ];

    // claude-haiku-4-5: static table says supportsThinkingMode = false.
    const events = await collect("claude-haiku-4-5", true);

    expect(events.filter((e) => e.type === "thinking_delta").length).toBe(0);
    const complete = events.find((e) => e.type === "content_complete");
    if (complete?.type !== "content_complete") throw new Error("expected content_complete");
    expect((complete as { thinking?: string }).thinking).toBeUndefined();
  }, 15000);
});
