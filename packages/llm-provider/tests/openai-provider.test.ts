// packages/llm-provider/tests/openai-provider.test.ts
// Task 5: OpenAI adapter — reasoning_effort + max_completion_tokens for thinking models.
// TDD: RED first (no capability entry yet, adapter always sends max_tokens).
//
// Run: bun test packages/llm-provider/tests/openai-provider.test.ts --timeout 15000

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
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
import { registerReportedModelMetadata, _resetReportedMetadataForTesting } from "../src/capability-reported.js";
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
  /** Per-call `CompletionRequest.thinking`; omitted from the request when undefined. */
  requestThinking?: boolean;
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
        ...(opts.requestThinking !== undefined ? { thinking: opts.requestThinking } : {}),
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

// Per-call override (CompletionRequest.thinking, H3 2026-11-05 defect 3).
describe("OpenAI per-call thinking override (request.thinking)", () => {
  it(
    "config thinking ON + request thinking:false → exactly the config-off body (no reserve, no reasoning_effort)",
    async () => {
      const overridden = await captureRequestBody({
        model: "o5-reasoning",
        thinking: true,
        thinkingOptions: { enabled: true, effort: "high" },
        maxTokens: 4000,
        requestThinking: false,
      });
      const configOff = await captureRequestBody({ model: "o5-reasoning", maxTokens: 4000 });
      expect(overridden.reasoning_effort).toBeUndefined();
      expect(overridden).toEqual(configOff);
    },
    15000,
  );

  it(
    "config thinking unset + request thinking:true → reasoning reserve for this call",
    async () => {
      const body = await captureRequestBody({
        model: "o5-reasoning",
        thinkingOptions: { effort: "low" },
        maxTokens: 4000,
        requestThinking: true,
      });
      expect(body.reasoning_effort).toBe("low");
      expect(body.max_completion_tokens).toBe(4000 + 16000);
    },
    15000,
  );
});

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
    "openai non-reasoning model + thinking true → warn+degrade: no reasoning_effort",
    async () => {
      // gpt-5.5 supportsThinkingMode=false → degrades silently with a console.warn.
      // gpt-5.x still requires max_completion_tokens (rejects max_tokens with 400).
      const body = await captureRequestBody({
        provider: "openai",
        model: "gpt-5.5",
        thinking: true,
        maxTokens: 4000,
      });
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.max_completion_tokens).toBe(4000);
      expect(body.max_tokens).toBeUndefined();
      // gpt-5.x rejects non-default temperature (live 400) -> omitted.
      expect(body.temperature).toBeUndefined();
    },
    15000,
  );
});

describe("gpt-5.x token field — max_completion_tokens required (no thinking)", () => {
  // Live-verified 2026-07-01 (thinking-ablation session): gpt-5.x rejects
  // `max_tokens` with 400 and requires `max_completion_tokens` on every call,
  // thinking or not. Capability flag `requiresMaxCompletionTokens` drives it.

  it(
    "gpt-5.4 default (thinking off) → max_completion_tokens, no max_tokens",
    async () => {
      const body = await captureRequestBody({
        provider: "openai",
        model: "gpt-5.4",
        maxTokens: 4000,
      });
      expect(body.max_completion_tokens).toBe(4000);
      expect(body.max_tokens).toBeUndefined();
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.temperature).toBeUndefined(); // gpt-5.x: live-confirmed 400 on temperature != 1
    },
    15000,
  );

  it(
    "gpt-5.4-mini default (thinking off) → max_completion_tokens, no max_tokens",
    async () => {
      const body = await captureRequestBody({
        provider: "openai",
        model: "gpt-5.4-mini",
        maxTokens: 2000,
      });
      expect(body.max_completion_tokens).toBe(2000);
      expect(body.max_tokens).toBeUndefined();
    },
    15000,
  );

  it(
    "legacy gpt-4o unchanged → plain max_tokens",
    async () => {
      const body = await captureRequestBody({
        provider: "openai",
        model: "gpt-4o",
        maxTokens: 4000,
      });
      expect(body.max_tokens).toBe(4000);
      expect(body.max_completion_tokens).toBeUndefined();
      expect(body.temperature).toBe(0.7);
    },
    15000,
  );
});

// ─── Temperature threading — adapter contract pins (GH temp-threading) ──────
//
// The Wave-4 close-capture defect was rooted UPSTREAM of this adapter
// (packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts:336
// drops the commanded config.temperature; the kernel then always stamps
// request.temperature, shadowing `request.temperature ?? defaultTemperature`
// in every provider). These pins certify the adapter half is correct and
// guard the ?? precedence: an explicit temperature 0 must reach the wire
// verbatim, never swallowed into the 0.7 default (a `||` refactor bug).
describe("OpenAI temperature threading — adapter pin", () => {
  async function captureTempBody(temperature?: number): Promise<Record<string, unknown>> {
    capturedCreateOpts = null;
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
        model: "gpt-4o",
      };
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        yield* llm.complete({
          model: "gpt-4o",
          messages: [{ role: "user", content: "hello" }],
          maxTokens: 100,
          ...(temperature !== undefined ? { temperature } : {}),
        });
      }).pipe(
        Effect.provide(
          makeLayer({
            model: "gpt-4o",
            maxTokens: 100,
          }),
        ),
      ),
    );
    return capturedCreateOpts!;
  }

  it(
    "explicit request temperature 0 reaches body.temperature verbatim",
    async () => {
      const body = await captureTempBody(0);
      expect(body.temperature).toBe(0);
    },
    15000,
  );

  it(
    "unset request temperature resolves to config.defaultTemperature (0.7)",
    async () => {
      const body = await captureTempBody();
      expect(body.temperature).toBe(0.7);
    },
    15000,
  );
});

// ─── Chat Completions tool-call reasoning rule (GPT-6 family) ───────────────
//
// OpenAI docs (verified 2026-10-29): GPT-5.6 Sol / GPT-6 Sol / GPT-6 Luna
// accept function tools on /v1/chat/completions ONLY with
// reasoning_effort "none". GPT-6 Astra / GPT-6.1 Sol / GPT-6.1 Terra accept
// function tools only through /v1/responses, so this adapter must fail fast
// with an actionable error instead of forwarding a raw provider 400.

const pingTool = {
  name: "ping",
  description: "Ping a host",
  inputSchema: {
    type: "object",
    properties: { host: { type: "string" } },
    required: ["host"],
  },
};

/** Capture the body of a complete() call that carries tools. */
async function captureToolBody(opts: {
  model: string;
  withTools: boolean;
  thinking?: boolean;
  thinkingOptions?: { enabled?: boolean; effort?: "low" | "medium" | "high" };
  maxTokens: number;
}): Promise<Record<string, unknown> | null> {
  capturedCreateOpts = null;
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
        ...(opts.withTools ? { tools: [pingTool] } : {}),
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
  return capturedCreateOpts;
}

describe("openai Chat Completions tools: reasoning_effort must be none", () => {
  beforeAll(() => {
    // Discovery-reported shape: a thinking-capable model, so the reserve path
    // (effort override) is actually exercised.
    registerReportedModelMetadata("openai", "gpt-6-sol", { maxContextTokens: 200_000, supportsThinkingMode: true });
  });
  afterAll(() => _resetReportedMetadataForTesting());

  it(
    "gpt-6-sol + tools, thinking off → tools kept, reasoning_effort none, max_completion_tokens",
    async () => {
      const body = await captureToolBody({
        model: "gpt-6-sol",
        withTools: true,
        maxTokens: 4000,
      });
      expect(body).not.toBeNull();
      expect(body!.tools).toBeDefined();
      expect(body!.reasoning_effort).toBe("none");
      expect(body!.max_completion_tokens).toBe(4000);
      expect(body!.max_tokens).toBeUndefined();
    },
    15000,
  );

  it(
    "gpt-6-sol + tools + thinking true effort high → effort overridden to none (reserve total kept)",
    async () => {
      const body = await captureToolBody({
        model: "gpt-6-sol",
        withTools: true,
        thinking: true,
        thinkingOptions: { enabled: true, effort: "high" },
        maxTokens: 4000,
      });
      expect(body).not.toBeNull();
      expect(body!.tools).toBeDefined();
      expect(body!.reasoning_effort).toBe("none");
      // reserve = clamp(4000 * 4) = 16000 → 4000 + 16000
      expect(body!.max_completion_tokens).toBe(20_000);
      expect(body!.max_tokens).toBeUndefined();
    },
    15000,
  );

  it(
    "gpt-6-sol WITHOUT tools + thinking true effort high → reasoning_effort unchanged",
    async () => {
      const body = await captureToolBody({
        model: "gpt-6-sol",
        withTools: false,
        thinking: true,
        thinkingOptions: { enabled: true, effort: "high" },
        maxTokens: 4000,
      });
      expect(body).not.toBeNull();
      expect(body!.reasoning_effort).toBe("high");
      expect(body!.max_completion_tokens).toBe(20_000);
    },
    15000,
  );

  it(
    "gpt-6-astra + tools → fails before the HTTP call with an actionable Responses API error",
    async () => {
      capturedCreateOpts = null;
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
          model: "gpt-6-astra",
        };
      });

      const error = await Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          model: "gpt-6-astra",
          messages: [{ role: "user", content: "hello" }],
          maxTokens: 4000,
          tools: [pingTool],
        });
      }).pipe(
        Effect.provide(makeLayer({ model: "gpt-6-astra", maxTokens: 4000 })),
        Effect.flip,
        Effect.runPromise,
      );

      expect(error._tag).toBe("LLMError");
      expect(error.message).toContain("gpt-6-astra");
      expect(error.message).toContain("/v1/responses");
      // Guard fires BEFORE the network call.
      expect(capturedCreateOpts).toBeNull();
    },
    15000,
  );

  it(
    "gpt-6-astra + tools on stream() fails before emitting anything",
    async () => {
      capturedCreateOpts = null;
      const error = await Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.stream({
          model: "gpt-6-astra",
          messages: [{ role: "user", content: "hello" }],
          maxTokens: 4000,
          tools: [pingTool],
        });
      }).pipe(
        Effect.provide(makeLayer({ model: "gpt-6-astra", maxTokens: 4000 })),
        Effect.flip,
        Effect.runPromise,
      );

      expect(error._tag).toBe("LLMError");
      expect(error.message).toContain("/v1/responses");
      expect(capturedCreateOpts).toBeNull();
    },
    15000,
  );
});

// Plan 9 Phase 4 stage C: image parts reach the wire (were silently dropped).
describe("OpenAI image parts — adapter wiring pin", () => {
  const sendImage = async (model: string) => {
    capturedCreateOpts = null;
    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        yield* llm.complete({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "what is this?" },
                { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
              ],
            },
          ],
          maxTokens: 256,
        });
      }).pipe(Effect.provide(makeLayer({ model, maxTokens: 256 }))),
    );
    return (capturedCreateOpts!.messages as Array<{ role: string; content: unknown }>)[0]!;
  };

  it("vision model: user image is sent as an image_url data-URL part", async () => {
    expect(await sendImage("gpt-4o")).toEqual({
      role: "user",
      content: [
        { type: "text", text: "what is this?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
      ],
    });
  }, 15000);

  it("non-vision model (static row): image becomes a deterministic stub", async () => {
    expect(await sendImage("o5-reasoning")).toEqual({
      role: "user",
      content: "what is this?[image omitted: image/png, 1 KB; model has no image input]",
    });
  }, 15000);
});
