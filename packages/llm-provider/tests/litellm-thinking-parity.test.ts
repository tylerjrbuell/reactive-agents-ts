// Run: bun test packages/llm-provider/tests/litellm-thinking-parity.test.ts
//
// F6 (architecture sweep 2026-07-07, 03-provider-model-params) — litellm was
// the only cloud provider with NO thinking or capability resolution. It now
// resolves both the same way openai.ts does (litellm proxies the OpenAI
// dialect): shared tri-state resolveThinkingEnabled gated on
// capability.supportsThinkingMode, reserveThinkingBudget on top of the answer
// budget, and the openai buildTokenField encoding (max_completion_tokens +
// reasoning_effort, temperature omitted on the reasoning path).

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  registerProbedCapability,
  _resetProbedRegistryForTesting,
} from "../src/capability-resolver.js";
import type { LLMService as LLMServiceType } from "../src/index.js";

// Capture the request body so we can assert the wire encoding.
let lastRequestBody: Record<string, unknown> | undefined;

// Scoped fetch mock (module-scope reassignment contaminates the workspace
// run — see litellm-stream-tool-calls.test.ts for the precedent).
const originalFetch = globalThis.fetch;
const mockFetch = (async (_url: unknown, opts?: unknown) => {
  const init = opts as { body?: string } | undefined;
  if (init?.body) {
    lastRequestBody = JSON.parse(init.body) as Record<string, unknown>;
  }
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      choices: [
        {
          message: { content: "ok", role: "assistant" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      model: "proxied",
    }),
    text: async () => "",
    body: new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(
          enc.encode(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            })}\n\n`,
          ),
        );
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
  } as unknown as Response;
}) as typeof fetch;

let LiteLLMProviderLive: Layer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  globalThis.fetch = mockFetch;
  const mod = await import("../src/index.js");
  LiteLLMProviderLive = mod.LiteLLMProviderLive as Layer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  _resetProbedRegistryForTesting();
});

afterEach(() => {
  lastRequestBody = undefined;
  _resetProbedRegistryForTesting();
});

const THINKING_MODEL = "anthropic/claude-sonnet-4-6";

/** Register a thinking-capable capability for the proxied model. */
const registerThinkingCapability = () =>
  registerProbedCapability({
    provider: "litellm",
    model: THINKING_MODEL,
    tier: "frontier",
    maxContextTokens: 200_000,
    recommendedNumCtx: 200_000,
    maxOutputTokens: 64_000,
    tokenizerFamily: "claude",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "probe",
  });

const makeLayer = (overrides: {
  thinking?: boolean;
  thinkingOptions?: { effort?: "low" | "medium" | "high"; budgetTokens?: number };
}) =>
  LiteLLMProviderLive.pipe(
    Layer.provide(
      Layer.succeed(
        LLMConfig,
        LLMConfig.of({
          defaultProvider: "litellm",
          defaultModel: "openai/gpt-4o-mini",
          embeddingConfig: {
            model: "text-embedding-3-small",
            dimensions: 3,
            provider: "openai" as const,
            batchSize: 100,
          },
          supportsPromptCaching: false,
          maxRetries: 1,
          timeoutMs: 30_000,
          defaultMaxTokens: 1024,
          defaultTemperature: 0.7,
          observabilityVerbosity: "full",
          ...overrides,
        }),
      ),
    ),
  );

const complete = (
  layer: Layer.Layer<LLMServiceType>,
  model: string,
): Promise<unknown> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* llm.complete({
        messages: [{ role: "user", content: "hello" }],
        model,
      });
    }).pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
  );

describe("LiteLLM F6 — thinking + capability parity with openai.ts", () => {
  it("thinking off (default): legacy max_tokens + temperature, no reasoning fields", async () => {
    await complete(makeLayer({}), "openai/gpt-4o-mini");

    expect(lastRequestBody).toBeDefined();
    expect(lastRequestBody?.max_tokens).toBe(1024);
    expect(lastRequestBody?.temperature).toBe(0.7);
    expect(lastRequestBody?.max_completion_tokens).toBeUndefined();
    expect(lastRequestBody?.reasoning_effort).toBeUndefined();
  });

  it("thinking:true + capable model: max_completion_tokens = budget + reserve, reasoning_effort, temperature omitted", async () => {
    registerThinkingCapability();
    await complete(
      makeLayer({ thinking: true, thinkingOptions: { effort: "high" } }),
      THINKING_MODEL,
    );

    // reserve = clamp(1024 * 4) = 4096 → 1024 + 4096 = 5120 (under the
    // registered 64k ceiling, so the F1 clamp is a no-op here).
    expect(lastRequestBody?.max_completion_tokens).toBe(5120);
    expect(lastRequestBody?.reasoning_effort).toBe("high");
    expect(lastRequestBody?.max_tokens).toBeUndefined();
    // I1 parity: reasoning path omits temperature.
    expect(lastRequestBody?.temperature).toBeUndefined();
  });

  it("thinking:true + incapable model (fallback capability): degrades to off — body unchanged", async () => {
    await complete(makeLayer({ thinking: true }), "openai/gpt-4o-mini");

    expect(lastRequestBody?.max_tokens).toBe(1024);
    expect(lastRequestBody?.temperature).toBe(0.7);
    expect(lastRequestBody?.max_completion_tokens).toBeUndefined();
    expect(lastRequestBody?.reasoning_effort).toBeUndefined();
  });

  it("stream(): same thinking encoding as complete()", async () => {
    registerThinkingCapability();
    const layer = makeLayer({ thinking: true, thinkingOptions: { effort: "medium" } });

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const { Stream } = yield* Effect.promise(() => import("effect"));
        const s = yield* llm.stream({
          messages: [{ role: "user", content: "hello" }],
          model: THINKING_MODEL,
        });
        return yield* Stream.runCollect(s);
      }).pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
    );

    expect(lastRequestBody?.stream).toBe(true);
    expect(lastRequestBody?.max_completion_tokens).toBe(5120);
    expect(lastRequestBody?.reasoning_effort).toBe("medium");
    expect(lastRequestBody?.temperature).toBeUndefined();
  });
});
