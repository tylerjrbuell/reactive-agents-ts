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
import { fetchStub } from "./helpers/fetch-stub.js";

// Capture the request body so we can assert the wire encoding.
let lastRequestBody: Record<string, unknown> | undefined;

// Scoped fetch mock (module-scope reassignment contaminates the workspace
// run — see litellm-stream-tool-calls.test.ts for the precedent).
const originalFetch = globalThis.fetch;
const mockFetch = fetchStub(async (_url, init) => {
  if (typeof init?.body === "string") {
    lastRequestBody = JSON.parse(init.body) as Record<string, unknown>;
  }
  // The same fake serves complete() (JSON body) and stream() (SSE body).
  if (lastRequestBody?.stream) {
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
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
      { status: 200, statusText: "OK" },
    );
  }
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "ok", role: "assistant" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      model: "proxied",
    }),
    { status: 200, statusText: "OK" },
  );
});

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

// Per-call override (CompletionRequest.thinking, H3 2026-11-05 defect 3):
// request thinking:false wins over config thinking:true on a capable model and
// yields the config-off body (no reserve, no reasoning_effort, temperature).
describe("LiteLLM per-call thinking override (request.thinking)", () => {
  const offBody = () => {
    expect(lastRequestBody?.max_tokens).toBe(1024);
    expect(lastRequestBody?.temperature).toBe(0.7);
    expect(lastRequestBody?.max_completion_tokens).toBeUndefined();
    expect(lastRequestBody?.reasoning_effort).toBeUndefined();
  };

  it("complete(): config thinking:true + request thinking:false → off body", async () => {
    registerThinkingCapability();
    const layer = makeLayer({ thinking: true, thinkingOptions: { effort: "high" } });
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "hello" }],
          model: THINKING_MODEL,
          thinking: false,
        });
      }).pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
    );
    offBody();
  });

  it("stream(): config thinking:true + request thinking:false → off body", async () => {
    registerThinkingCapability();
    const layer = makeLayer({ thinking: true, thinkingOptions: { effort: "high" } });
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const { Stream } = yield* Effect.promise(() => import("effect"));
        const s = yield* llm.stream({
          messages: [{ role: "user", content: "hello" }],
          model: THINKING_MODEL,
          thinking: false,
        });
        return yield* Stream.runCollect(s);
      }).pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
    );
    expect(lastRequestBody?.stream).toBe(true);
    offBody();
  });
});

// ─── Chat Completions tool rule parity (GPT-6 family) ───────────────────────
//
// LiteLLM proxies the OpenAI dialect, so the same restriction applies to a
// proxied `openai/...` route: tools need reasoning_effort "none" on
// GPT-5.6 Sol / GPT-6 Sol / GPT-6 Luna, and are Responses-only on GPT-6 Astra
// / GPT-6.1 Sol / GPT-6.1 Terra.

const pingTool = {
  name: "ping",
  description: "Ping a host",
  inputSchema: { type: "object", properties: { host: { type: "string" } } },
};

const completeWithTools = (
  layer: Layer.Layer<LLMServiceType>,
  model: string,
): Promise<unknown> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* llm.complete({
        messages: [{ role: "user", content: "hello" }],
        model,
        tools: [pingTool],
      });
    }).pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
  );

describe("LiteLLM chat-tools reasoning rule parity", () => {
  it("proxied openai/gpt-6-sol + tools forces reasoning_effort none", async () => {
    await completeWithTools(
      makeLayer({ thinking: true, thinkingOptions: { effort: "high" } }),
      "openai/gpt-6-sol",
    );

    expect(lastRequestBody?.tools).toBeDefined();
    expect(lastRequestBody?.reasoning_effort).toBe("none");
    // litellm rows are never reported-inferred, so no thinking reserve: the
    // plain answer budget goes out as max_completion_tokens.
    expect(lastRequestBody?.max_completion_tokens).toBe(1024);
    expect(lastRequestBody?.max_tokens).toBeUndefined();
  });

  it("proxied openai/gpt-6-astra + tools fails before the HTTP call", async () => {
    const error = await Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* llm.complete({
        messages: [{ role: "user", content: "hello" }],
        model: "openai/gpt-6-astra",
        tools: [pingTool],
      });
    }).pipe(
      Effect.provide(makeLayer({}) as Layer.Layer<LLMServiceType, unknown>),
      Effect.flip,
      Effect.runPromise,
    );

    expect(error._tag).toBe("LLMError");
    expect(error.message).toContain("litellm");
    expect(error.message).toContain("/v1/responses");
    expect(lastRequestBody).toBeUndefined();
  });
});
