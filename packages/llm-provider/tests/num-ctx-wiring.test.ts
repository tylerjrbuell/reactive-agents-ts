// Run: bun test packages/llm-provider/tests/num-ctx-wiring.test.ts --timeout 15000
//
// G-1 regression test — Ollama provider must set options.num_ctx on every
// request. Without this, Ollama silently caps context at 2048 tokens, causing
// long conversations or large tool results to be truncated silently.
//
// North Star v2.3 §1.2 G-1 and §11 Attack 1.

import { describe, it, expect, mock, afterAll } from "bun:test";
import { Effect, Layer } from "effect";

// ─── Mock the `ollama` package BEFORE provider module is imported ───

// Bun module mocks are process-global and leak across test FILES. Capture the
// real module and re-install it in afterAll so later files (e.g. runtime
// live-Ollama tests) hit the real SDK again.
const realOllamaModule = { ...(await import("ollama")) };
afterAll(() => {
  mock.module("ollama", () => realOllamaModule);
});

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
const runtimeModule = await import("../src/runtime.js");
const { createLLMProviderLayer } = runtimeModule;
import { LLMService } from "../src/llm-service.js";
import { LLMConfig } from "../src/llm-config.js";

const makeTestConfigLayer = (overrides: Partial<{ defaultNumCtx: number; explicitNumCtx: number }> = {}) =>
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
  it("sets options.num_ctx on complete() requests (capability.recommendedNumCtx wins over defaultNumCtx)", async () => {
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
    // cogito:14b is in the static table → capability.recommendedNumCtx (32768)
    // wins over config.defaultNumCtx (8192). Proves num_ctx is always set.
    expect(chatArgs.options?.num_ctx).toBe(32768);
  }, 15000);

  // Phase 1 S1.3 changed this assertion: capability-driven resolution now
  // always supplies num_ctx for known models. Static table for cogito:14b
  // declares recommendedNumCtx=32768 — that's what the Ollama request gets,
  // even with no defaultNumCtx config and no explicit request.numCtx. The
  // Phase 0 surgical fix's "respect Ollama default 2048" path is replaced
  // by Phase 1's "respect the model's documented context window".
  it("uses capability.recommendedNumCtx when defaultNumCtx is not configured (cogito:14b → 32768 from static table)", async () => {
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
    expect(chatArgs.options?.num_ctx).toBe(32768);
  }, 15000);

  it("unknown model falls back to capability fallback (2048) when no other override", async () => {
    mockChat.mockClear();

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Say hi" }],
          // Force a model NOT in the static table → fallback path
          model: { provider: "ollama", model: "private-model:custom" },
        });
      }).pipe(
        Effect.provide(LocalProviderLive.pipe(Layer.provide(makeTestConfigLayer()))),
      ),
    );

    const chatArgs = mockChat.mock.calls[0]![0] as {
      options?: { num_ctx?: number };
    };
    // Fallback Capability has recommendedNumCtx: 2048 — matches Ollama's
    // silent default but is now explicit + observable in telemetry.
    expect(chatArgs.options?.num_ctx).toBe(2048);
  }, 15000);

  it("capability.recommendedNumCtx wins over config.defaultNumCtx (defaultNumCtx is deprecated fallback)", async () => {
    mockChat.mockClear();

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Say hi" }],
        });
      }).pipe(
        // defaultNumCtx=99999 set high to prove it does NOT win over capability
        Effect.provide(LocalProviderLive.pipe(Layer.provide(makeTestConfigLayer({ defaultNumCtx: 99999 })))),
      ),
    );

    const chatArgs = mockChat.mock.calls[0]![0] as {
      options?: { num_ctx?: number };
    };
    // cogito:14b's capability.recommendedNumCtx=32768 must win over the
    // deprecated config.defaultNumCtx=99999. Confirms the new precedence.
    expect(chatArgs.options?.num_ctx).toBe(32768);
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

  // ── explicitNumCtx: user override via .withModel({ numCtx }) / agent.run({ numCtx }) ──
  // Ranks ABOVE capability.recommendedNumCtx so a user can widen past the
  // conservative 32K cap (e.g. they have GPU headroom) or narrow it.

  it("explicitNumCtx wins over capability.recommendedNumCtx (user widens past the 32K cap)", async () => {
    mockChat.mockClear();

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Say hi" }],
        });
      }).pipe(
        // cogito:14b capability=32768; user-explicit 65536 must win.
        Effect.provide(LocalProviderLive.pipe(Layer.provide(makeTestConfigLayer({ explicitNumCtx: 65536 })))),
      ),
    );

    const chatArgs = mockChat.mock.calls[0]![0] as {
      options?: { num_ctx?: number };
    };
    expect(chatArgs.options?.num_ctx).toBe(65536);
  }, 15000);

  it("request.numCtx still wins over explicitNumCtx (per-call beats per-agent)", async () => {
    mockChat.mockClear();

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Say hi" }],
          numCtx: 4096,
        });
      }).pipe(
        Effect.provide(LocalProviderLive.pipe(Layer.provide(makeTestConfigLayer({ explicitNumCtx: 65536 })))),
      ),
    );

    const chatArgs = mockChat.mock.calls[0]![0] as {
      options?: { num_ctx?: number };
    };
    expect(chatArgs.options?.num_ctx).toBe(4096);
  }, 15000);

  // Pipe test — goes THROUGH createLLMProviderLayer({ numCtx }) rather than a
  // hand-built LLMConfig. `configOverrides` is Record<string, unknown>, so a
  // typo in the "explicitNumCtx" key would compile clean and silently no-op.
  // This is the only test that catches that.
  it("createLLMProviderLayer({ numCtx }) reaches Ollama as num_ctx (pipe end-to-end)", async () => {
    mockChat.mockClear();

    const layer = createLLMProviderLayer(
      "ollama",
      undefined,
      "cogito:14b",
      { numCtx: 49152 },
      false,
    ) as Layer.Layer<LLMService>;

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Say hi" }],
        });
      }).pipe(Effect.provide(layer)),
    );

    const chatArgs = mockChat.mock.calls[0]![0] as {
      options?: { num_ctx?: number };
    };
    // 49152 > capability 32768 — proves modelParams.numCtx flowed into
    // config.explicitNumCtx and won over the capability default.
    expect(chatArgs.options?.num_ctx).toBe(49152);
  }, 15000);
});
