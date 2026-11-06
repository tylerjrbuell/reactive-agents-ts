// packages/llm-provider/tests/anthropic-claude-5-family.test.ts
// Run: bun test packages/llm-provider/tests/anthropic-claude-5-family.test.ts --timeout 15000
//
// Two live faults found in Cortex (2026-11-05) on a claude-haiku-5-5 chat turn:
//   1. 400 "temperature is deprecated for this model" — the adapter always
//      sent `temperature`. The capability row now carries `rejectsTemperature`
//      and the adapter omits the field on complete / stream / structured.
//   2. The Claude 5 ids had no static row, so they resolved to the 2048-ctx
//      fallback, which starves context assembly.
// Zero-token: the Anthropic SDK is mocked; no network.

import { describe, it, expect, mock, beforeAll, afterAll, beforeEach } from "bun:test";
import { Effect, Layer, Schema, Stream } from "effect";

// Bun module mocks are process-global; restore the real SDK for later files.
const realAnthropicSdk = { ...(await import("@anthropic-ai/sdk")) };
afterAll(() => {
  mock.module("@anthropic-ai/sdk", () => realAnthropicSdk);
});

let capturedCreateOpts: Record<string, unknown> | null = null;
let capturedStreamOpts: Record<string, unknown> | null = null;
let responseText = "ok";

const makeResponse = () => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: responseText }],
  model: "claude-haiku-5-5",
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 5 },
});

const mockCreate = mock(async (opts: unknown) => {
  capturedCreateOpts = opts as Record<string, unknown>;
  return makeResponse();
});

const mockStream = mock((opts: unknown) => {
  capturedStreamOpts = opts as Record<string, unknown>;
  const obj: { on: (event: string, cb: (m: unknown) => void) => unknown } = {
    on(event, cb) {
      if (event === "finalMessage") setTimeout(() => cb(makeResponse()), 0);
      return obj;
    },
  };
  return obj;
});

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate, stream: mockStream };
  },
}));

import type { LLMService as LLMServiceType } from "../src/index.js";

let AnthropicProviderLive: Layer.Layer<LLMServiceType>;
let LLMService: (typeof import("../src/index.js"))["LLMService"];
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let resolveCapability: (typeof import("../src/index.js"))["resolveCapability"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  AnthropicProviderLive = mod.AnthropicProviderLive as Layer.Layer<LLMServiceType>;
  LLMService = mod.LLMService;
  LLMConfig = mod.LLMConfig;
  resolveCapability = mod.resolveCapability;
});

beforeEach(() => {
  capturedCreateOpts = null;
  capturedStreamOpts = null;
  responseText = "ok";
});

const layerFor = (model: string) =>
  Layer.provide(
    AnthropicProviderLive,
    Layer.succeed(
      LLMConfig,
      LLMConfig.of({
        defaultProvider: "anthropic",
        defaultModel: model,
        anthropicApiKey: "test-key",
        defaultMaxTokens: 1024,
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

const runComplete = (model: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* llm.complete({ messages: [{ role: "user", content: "hi" }], temperature: 0.3 });
    }).pipe(Effect.provide(layerFor(model))),
  );

const runStream = (model: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const stream = yield* llm.stream({ messages: [{ role: "user", content: "hi" }], temperature: 0.3 });
      return yield* Stream.runDrain(stream);
    }).pipe(Effect.provide(layerFor(model))),
  );

const runStructured = (model: string) => {
  responseText = '"a": 1}';
  return Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* llm.completeStructured({
        messages: [{ role: "user", content: "give a" }],
        outputSchema: Schema.Struct({ a: Schema.Number }),
        temperature: 0.3,
      });
    }).pipe(Effect.provide(layerFor(model))),
  );
};

describe("claude-haiku-5-5 rejects temperature: request bodies omit it", () => {
  it("complete() sends no temperature", async () => {
    await runComplete("claude-haiku-5-5");
    expect(capturedCreateOpts).not.toBeNull();
    expect("temperature" in capturedCreateOpts!).toBe(false);
  });

  it("stream() sends no temperature", async () => {
    await runStream("claude-haiku-5-5");
    expect(capturedStreamOpts).not.toBeNull();
    expect("temperature" in capturedStreamOpts!).toBe(false);
  });

  it("completeStructured() sends no temperature", async () => {
    await runStructured("claude-haiku-5-5");
    expect(capturedCreateOpts).not.toBeNull();
    expect("temperature" in capturedCreateOpts!).toBe(false);
  });

  it("a model that accepts temperature still receives the requested value", async () => {
    await runComplete("claude-sonnet-4-6");
    expect(capturedCreateOpts!.temperature).toBe(0.3);
    await runStream("claude-sonnet-4-6");
    expect(capturedStreamOpts!.temperature).toBe(0.3);
  });
});

describe("Claude 5 family resolves to a static capability row", () => {
  const ids = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
  for (const id of ids) {
    it(`${id} is static-table, not the 2048 fallback`, () => {
      const cap = resolveCapability("anthropic", id);
      expect(cap.source).toBe("static-table");
      expect(cap.model).toBe(id);
      expect(cap.recommendedNumCtx).toBeGreaterThanOrEqual(200_000);
      expect(cap.maxOutputTokens).toBeGreaterThanOrEqual(64_000);
      expect(cap.toolCallDialect).toBe("native-fc");
    });
  }

  it("only claude-haiku-5-5 is flagged rejectsTemperature (the one live-confirmed id)", () => {
    expect(resolveCapability("anthropic", "claude-haiku-5-5").rejectsTemperature).toBe(true);
    for (const id of ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-sonnet-4-6"]) {
      expect(resolveCapability("anthropic", id).rejectsTemperature).not.toBe(true);
    }
  });
});
