// Run: bun test packages/llm-provider/tests/num-ctx-wiring.test.ts --timeout 15000
//
// G-1 regression test — Ollama provider must set options.num_ctx on every
// request. Without this, Ollama silently caps context at 2048 tokens, causing
// long conversations or large tool results to be truncated silently.
//
// North Star v2.3 §1.2 G-1 and §11 Attack 1.

import { describe, it, expect, mock } from "bun:test";
import { Effect, Layer } from "effect";

// ─── Mock the `ollama` package BEFORE provider module is imported ───

const mockChat = mock(async (_opts: unknown) => ({
  model: "cogito:14b",
  message: {
    role: "assistant",
    content: "Paris",
    tool_calls: undefined,
  },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 10,
  eval_count: 5,
}));

const mockEmbed = mock(async () => ({ embeddings: [[0.1, 0.2, 0.3]] }));
const mockShow = mock(async () => ({ template: "default" }));

mock.module("ollama", () => ({
  Ollama: class MockOllama {
    constructor(_opts?: { host?: string }) {}
    chat = mockChat;
    embed = mockEmbed;
    show = mockShow;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const providerModule = await import("../src/providers/local.js");
const { LocalProviderLive } = providerModule;
import { LLMService } from "../src/llm-service.js";
import { LLMConfig } from "../src/llm-config.js";

const makeTestConfigLayer = (overrides: Partial<{ defaultNumCtx: number }> = {}) =>
  Layer.succeed(LLMConfig, {
    defaultModel: "cogito:14b",
    baseUrl: "http://localhost:11434",
    timeoutMs: 10_000,
    maxRetries: 0,
    defaultMaxTokens: 512,
    defaultTemperature: 0.1,
    observabilityVerbosity: "metadata" as const,
    pricingRegistry: {},
    ...overrides,
  } as LLMConfig["Type"]);

describe("Ollama provider — num_ctx wiring (G-1)", () => {
  it("sets options.num_ctx on complete() requests when defaultNumCtx is configured", async () => {
    mockChat.mockClear();

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Say hi" }],
        });
      }).pipe(
        Effect.provide(LocalProviderLive.pipe(Layer.provide(makeTestConfigLayer({ defaultNumCtx: 8192 })))),
      ),
    );

    expect(mockChat.mock.calls.length).toBeGreaterThan(0);
    const chatArgs = mockChat.mock.calls[0]![0] as {
      options?: { num_ctx?: number };
    };
    expect(chatArgs.options).toBeDefined();
    expect(chatArgs.options?.num_ctx).toBe(8192);
  }, 15000);

  it("omits num_ctx when defaultNumCtx is not configured (respects Ollama default)", async () => {
    mockChat.mockClear();

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Say hi" }],
        });
      }).pipe(
        Effect.provide(LocalProviderLive.pipe(Layer.provide(makeTestConfigLayer()))),
      ),
    );

    const chatArgs = mockChat.mock.calls[0]![0] as {
      options?: { num_ctx?: number };
    };
    expect(chatArgs.options?.num_ctx).toBeUndefined();
  }, 15000);

  it("allows per-request override via request.numCtx", async () => {
    mockChat.mockClear();

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Say hi" }],
          numCtx: 16384,
        });
      }).pipe(
        Effect.provide(LocalProviderLive.pipe(Layer.provide(makeTestConfigLayer({ defaultNumCtx: 8192 })))),
      ),
    );

    const chatArgs = mockChat.mock.calls[0]![0] as {
      options?: { num_ctx?: number };
    };
    expect(chatArgs.options?.num_ctx).toBe(16384);
  }, 15000);
});
