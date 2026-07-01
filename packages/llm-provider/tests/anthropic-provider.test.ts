import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, Layer } from "effect";

// ─── Mock @anthropic-ai/sdk BEFORE the provider module is imported ───
// Pattern mirrors anthropic-prompt-caching.test.ts. Must precede any dynamic
// import of the provider so mock.module intercepts the lazy SDK load.

let capturedCreateOpts: Record<string, unknown> | null = null;

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

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
      stream: () => ({ on: () => {} }),
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
        makeLayer({ model: opts.model, thinking: opts.thinking, maxTokens: opts.maxTokens }),
      ),
    ),
  );
  return capturedCreateOpts!;
}

// ─── Tests ───

describe("Anthropic extended thinking", () => {
  it(
    "thinking true → body has thinking{enabled,budget} + max_tokens=answer+budget",
    async () => {
      // claude-opus-4-8 supportsThinkingMode=true; budget = clamp(2000*4, 1024, 16384) = 8000
      const body = await captureRequestBody({
        model: "claude-opus-4-8",
        thinking: true,
        maxTokens: 2000,
      });
      expect(body.thinking).toMatchObject({ type: "enabled", budget_tokens: 8000 });
      expect(body.max_tokens).toBe(2000 + 8000);
    },
    15000,
  );

  it(
    "thinking undefined → no thinking field, max_tokens unchanged",
    async () => {
      const body = await captureRequestBody({
        model: "claude-opus-4-8",
        maxTokens: 2000,
      });
      expect(body.thinking).toBeUndefined();
      expect(body.max_tokens).toBe(2000);
    },
    15000,
  );
});
