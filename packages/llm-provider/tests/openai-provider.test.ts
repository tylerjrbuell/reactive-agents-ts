// packages/llm-provider/tests/openai-provider.test.ts
// Task 5: OpenAI adapter — reasoning_effort + max_completion_tokens for thinking models.
// TDD: RED first (no capability entry yet, adapter always sends max_tokens).
//
// Run: bun test packages/llm-provider/tests/openai-provider.test.ts --timeout 15000

import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, Layer } from "effect";

// ─── Mock openai SDK BEFORE the provider module is imported ───
// Uses mock.module to intercept dynamic import("openai") in openai.ts.
// Pattern mirrors anthropic-provider.test.ts.

let capturedCreateOpts: Record<string, unknown> | null = null;

const mockCreate = mock(async (opts: unknown) => {
  capturedCreateOpts = opts as Record<string, unknown>;
  return {
    choices: [
      {
        message: { content: "ok", role: "assistant", tool_calls: undefined },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
    model: "mock-model",
  };
});

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
    embeddings = {
      create: mock(async () => ({ data: [] })),
    };
  },
}));

// ─── Lazy imports (after mock registration) ───

import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";

let OpenAIProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMService: typeof import("../src/index.js")["LLMService"];
let LLMConfig: typeof import("../src/index.js")["LLMConfig"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  OpenAIProviderLive = mod.OpenAIProviderLive;
  LLMService = mod.LLMService;
  LLMConfig = mod.LLMConfig;
});

// ─── Helpers ───

function makeLayer(opts: {
  model?: string;
  thinking?: boolean;
  thinkingOptions?: { enabled?: boolean; effort?: "low" | "medium" | "high" };
  maxTokens?: number;
} = {}) {
  return Layer.provide(
    OpenAIProviderLive,
    Layer.succeed(
      LLMConfig,
      LLMConfig.of({
        defaultProvider: "openai",
        defaultModel: opts.model ?? "gpt-4o",
        openaiApiKey: "test-key",
        thinking: opts.thinking,
        thinkingOptions: opts.thinkingOptions,
        defaultMaxTokens: opts.maxTokens ?? 4096,
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

/**
 * Run a complete() call through the OpenAI provider with given config
 * and capture the raw request body sent to the SDK.
 */
async function captureRequestBody(opts: {
  provider?: string;
  model: string;
  thinking?: boolean;
  thinkingOptions?: { enabled?: boolean; effort?: "low" | "medium" | "high" };
  maxTokens: number;
}): Promise<Record<string, unknown>> {
  capturedCreateOpts = null;
  // Use mockImplementationOnce so each captureRequestBody call gets a fresh capture
  mockCreate.mockImplementationOnce(async (body: unknown) => {
    capturedCreateOpts = body as Record<string, unknown>;
    return {
      choices: [
        {
          message: { content: "ok", role: "assistant", tool_calls: undefined },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      model: opts.model,
    };
  });
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

// ─── Tests ───

describe("OpenAI reasoning model thinking (Task 5)", () => {
  it(
    "openai reasoning model + thinking true → reasoning_effort + max_completion_tokens, no max_tokens",
    async () => {
      // o5-reasoning supportsThinkingMode=true; reserve = clamp(4000*4, 1024, 16384) = 16000
      const body = await captureRequestBody({
        provider: "openai",
        model: "o5-reasoning",
        thinking: true,
        thinkingOptions: { enabled: true, effort: "high" },
        maxTokens: 4000,
      });
      expect(body.reasoning_effort).toBe("high");
      // reserve = clamp(4000*4=16000, MIN=1024, MAX=16384) = 16000 (not capped — 16000 < 16384)
      expect(body.max_completion_tokens).toBe(4000 + 16000);
      expect(body.max_tokens).toBeUndefined();
      // I1: reasoning models reject temperature → must be omitted entirely.
      expect(Object.keys(body)).not.toContain("temperature");
    },
    15000,
  );

  it(
    "openai non-reasoning model + thinking true → warn+degrade: plain max_tokens, no reasoning_effort",
    async () => {
      // gpt-5.5 supportsThinkingMode=false → degrades silently with a console.warn
      const body = await captureRequestBody({
        provider: "openai",
        model: "gpt-5.5",
        thinking: true,
        maxTokens: 4000,
      });
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.max_tokens).toBe(4000);
      // Non-reasoning path keeps temperature (today's behavior).
      expect(body.temperature).toBe(0.7);
    },
    15000,
  );
});
