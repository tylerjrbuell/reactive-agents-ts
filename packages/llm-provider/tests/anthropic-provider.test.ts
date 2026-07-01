import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

// ─── Mock @anthropic-ai/sdk BEFORE the provider module is imported ───
// Pattern mirrors anthropic-prompt-caching.test.ts. Must precede any dynamic
// import of the provider so mock.module intercepts the lazy SDK load.

let capturedCreateOpts: Record<string, unknown> | null = null;
let capturedStreamOpts: Record<string, unknown> | null = null;

const mockCreate = mock(async (opts: unknown) => {
  capturedCreateOpts = opts as Record<string, unknown>;
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    model: "claude-opus-4-8",
    stop_reason: "end_turn",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
    },
  };
});

const mockStream = mock((opts: unknown) => {
  capturedStreamOpts = opts as Record<string, unknown>;
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  // Fire finalMessage once the provider has registered its handlers so the
  // Effect stream completes deterministically (lets us drain + capture opts).
  queueMicrotask(() => {
    handlers.finalMessage?.({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
      model: "claude-opus-4-8",
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
      create: mockCreate,
      stream: mockStream,
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

// ─── Helpers ───

function makeLayer(opts: {
  model?: string;
  thinking?: boolean;
  thinkingOptions?: { enabled?: boolean; effort?: "low" | "medium" | "high"; budgetTokens?: number };
  maxTokens?: number;
} = {}) {
  return Layer.provide(
    AnthropicProviderLive,
    Layer.succeed(
      LLMConfig,
      LLMConfig.of({
        defaultProvider: "anthropic",
        defaultModel: opts.model ?? "claude-opus-4-8",
        anthropicApiKey: "test-key",
        thinking: opts.thinking,
        thinkingOptions: opts.thinkingOptions,
        defaultMaxTokens: opts.maxTokens ?? 4096,
        defaultTemperature: 0.7,
        supportsPromptCaching: true,
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

/**
 * Run a complete() call through the Anthropic provider with given config
 * and capture the raw request body sent to the SDK.
 */
async function captureRequestBody(opts: {
  model: string;
  thinking?: boolean;
  thinkingOptions?: { enabled?: boolean; effort?: "low" | "medium" | "high"; budgetTokens?: number };
  maxTokens: number;
}): Promise<Record<string, unknown>> {
  capturedCreateOpts = null;
  await Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      yield* llm.complete({
        model: opts.model,
        messages: [{ role: "user", content: "hello" }],
        maxTokens: opts.maxTokens,
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          model: opts.model,
          thinking: opts.thinking,
          thinkingOptions: opts.thinkingOptions,
          maxTokens: opts.maxTokens,
        }),
      ),
    ),
  );
  return capturedCreateOpts!;
}

/**
 * Run a stream() call through the Anthropic provider and capture the raw
 * request body sent to the SDK's `messages.stream`.
 */
async function captureStreamBody(opts: {
  model: string;
  thinking?: boolean;
  thinkingOptions?: { enabled?: boolean; effort?: "low" | "medium" | "high"; budgetTokens?: number };
  maxTokens: number;
}): Promise<Record<string, unknown>> {
  capturedStreamOpts = null;
  await Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const events = yield* llm.stream({
        model: opts.model,
        messages: [{ role: "user", content: "hello" }],
        maxTokens: opts.maxTokens,
      });
      yield* Stream.runDrain(events);
    }).pipe(
      Effect.provide(
        makeLayer({
          model: opts.model,
          thinking: opts.thinking,
          thinkingOptions: opts.thinkingOptions,
          maxTokens: opts.maxTokens,
        }),
      ),
    ),
  );
  return capturedStreamOpts!;
}

// ─── Tests ───

describe("Anthropic extended thinking — adaptive form (Opus 4.8)", () => {
  it(
    "complete: adaptive model + thinking + effort → thinking{adaptive} + output_config, no budget_tokens, no temperature",
    async () => {
      // claude-opus-4-8 → adaptive form; reserve = clamp(2000*4,1024,16384) = 8000
      const body = await captureRequestBody({
        model: "claude-opus-4-8",
        thinking: true,
        thinkingOptions: { enabled: true, effort: "high" },
        maxTokens: 2000,
      });
      expect(body.thinking).toEqual({ type: "adaptive" });
      expect(body.output_config).toEqual({ effort: "high" });
      expect(body.max_tokens).toBe(2000 + 8000);
      expect(body.budget_tokens).toBeUndefined();
      expect(Object.keys(body)).not.toContain("temperature");
    },
    15000,
  );

  it(
    "complete: adaptive model + thinking, no effort → no output_config (API default)",
    async () => {
      const body = await captureRequestBody({
        model: "claude-opus-4-8",
        thinking: true,
        maxTokens: 2000,
      });
      expect(body.thinking).toEqual({ type: "adaptive" });
      expect(body.output_config).toBeUndefined();
      expect(Object.keys(body)).not.toContain("temperature");
    },
    15000,
  );

  it(
    "stream: adaptive model + thinking + effort → thinking{adaptive} + output_config, no temperature",
    async () => {
      const body = await captureStreamBody({
        model: "claude-opus-4-8",
        thinking: true,
        thinkingOptions: { enabled: true, effort: "medium" },
        maxTokens: 2000,
      });
      expect(body.thinking).toEqual({ type: "adaptive" });
      expect(body.output_config).toEqual({ effort: "medium" });
      expect(body.max_tokens).toBe(2000 + 8000);
      expect(Object.keys(body)).not.toContain("temperature");
    },
    15000,
  );
});

describe("Anthropic extended thinking — legacy enabled form (Sonnet 4.5)", () => {
  it(
    "complete: legacy model + thinking → thinking{enabled,budget_tokens}, no output_config, no temperature",
    async () => {
      // claude-sonnet-4-5-20250929 → enabled form; reserve = clamp(2000*4,...) = 8000
      const body = await captureRequestBody({
        model: "claude-sonnet-4-5-20250929",
        thinking: true,
        thinkingOptions: { enabled: true, effort: "high" },
        maxTokens: 2000,
      });
      expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8000 });
      expect(body.output_config).toBeUndefined();
      expect(body.max_tokens).toBe(2000 + 8000);
      expect(Object.keys(body)).not.toContain("temperature");
    },
    15000,
  );

  it(
    "stream: legacy model + thinking → thinking{enabled,budget_tokens}, no temperature",
    async () => {
      const body = await captureStreamBody({
        model: "claude-sonnet-4-5-20250929",
        thinking: true,
        maxTokens: 2000,
      });
      expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8000 });
      expect(body.output_config).toBeUndefined();
      expect(Object.keys(body)).not.toContain("temperature");
    },
    15000,
  );
});

describe("Anthropic thinking OFF path (byte-identical to pre-thinking)", () => {
  it(
    "complete: thinking undefined → no thinking, temperature present, max_tokens unchanged",
    async () => {
      const body = await captureRequestBody({
        model: "claude-opus-4-8",
        maxTokens: 2000,
      });
      expect(body.thinking).toBeUndefined();
      expect(body.output_config).toBeUndefined();
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(2000);
    },
    15000,
  );

  it(
    "stream: thinking undefined → no thinking, temperature present, max_tokens unchanged",
    async () => {
      const body = await captureStreamBody({
        model: "claude-opus-4-8",
        maxTokens: 2000,
      });
      expect(body.thinking).toBeUndefined();
      expect(body.output_config).toBeUndefined();
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(2000);
    },
    15000,
  );
});
