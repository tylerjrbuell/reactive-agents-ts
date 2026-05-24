// Run: bun test packages/llm-provider/tests/litellm-stream-tool-calls.test.ts --timeout 15000
//
// LiteLLM stream() tool_calls accumulation + adapter wiring parity.
//
// LiteLLM proxies OpenAI-compat dialect. Pre-existing wiring test
// (provider-adapter-wiring.test.ts) covers complete() across all four
// non-local providers but explicitly gates streaming follow-up. This file
// completes that follow-up specifically for LiteLLM:
//
//   1. stream() forwards `tools` to the proxy request body
//   2. tool_calls deltas accumulate by index across SSE chunks
//   3. tool_use_start + tool_use_delta are emitted (per-chunk path, no adapter)
//   4. With adapter.parseToolCalls registered, per-chunk emissions are
//      suppressed and a single pair is synthesized at finish_reason

import { describe, it, expect, mock, beforeAll, afterEach } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import type { ProviderAdapter } from "../src/adapter.js";
import {
  localModelAdapter,
  defaultAdapter,
  midModelAdapter,
} from "../src/adapter.js";
import type { StreamEvent } from "../src/types.js";

// Adapter override seam (mirrors provider-adapter-wiring.test.ts).
let overrideAdapter: ProviderAdapter | null = null;
mock.module("../src/adapter.js", () => ({
  localModelAdapter,
  defaultAdapter,
  midModelAdapter,
  selectAdapter: (
    _caps: { supportsToolCalling: boolean },
    tier?: string,
    _modelId?: string,
  ) => {
    if (overrideAdapter) return { adapter: overrideAdapter };
    if (tier === "local") return { adapter: localModelAdapter };
    if (tier === "mid") return { adapter: midModelAdapter };
    return { adapter: defaultAdapter };
  },
}));

// Capture the request body so we can assert `tools` is forwarded.
let lastRequestBody: Record<string, unknown> | undefined;

// Build a ReadableStream of SSE-encoded chunks (each chunk is one
// `data: {...}\n\n` frame, terminated by `data: [DONE]\n\n`).
const sseStream = (frames: ReadonlyArray<string>): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
};

let nextStreamFrames: ReadonlyArray<string> = [];

globalThis.fetch = (async (_url: unknown, opts?: unknown) => {
  const init = opts as { body?: string } | undefined;
  if (init?.body) {
    lastRequestBody = JSON.parse(init.body) as Record<string, unknown>;
  }
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: sseStream(nextStreamFrames),
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}) as typeof fetch;

import type { LLMService as LLMServiceType } from "../src/index.js";

let LiteLLMProviderLive: Layer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  LiteLLMProviderLive = mod.LiteLLMProviderLive as Layer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

afterEach(() => {
  overrideAdapter = null;
  lastRequestBody = undefined;
  nextStreamFrames = [];
});

const makeLiteLLMLayer = () =>
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
        }),
      ),
    ),
  );

const runWith = <A>(eff: Effect.Effect<A, unknown, LLMServiceType>) =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(makeLiteLLMLayer() as Layer.Layer<LLMServiceType, unknown>),
    ),
  );

const drainEvents = (
  stream: Stream.Stream<StreamEvent, unknown>,
): Effect.Effect<StreamEvent[], unknown, never> =>
  Stream.runCollect(stream).pipe(Effect.map((chunk) => Array.from(chunk)));

describe("LiteLLM stream() — tool_calls + adapter wiring", () => {
  it("forwards `tools` to the proxy request body", async () => {
    nextStreamFrames = [
      JSON.stringify({
        choices: [{ delta: { content: "ok" }, finish_reason: null }],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      }),
    ];

    await runWith(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const s = yield* llm.stream({
          messages: [{ role: "user", content: "hello" }],
          model: "openai/gpt-4o-mini",
          tools: [
            {
              name: "web_search",
              description: "search the web",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        });
        return yield* drainEvents(s);
      }),
    );

    expect(lastRequestBody).toBeDefined();
    expect(lastRequestBody?.stream).toBe(true);
    expect(Array.isArray(lastRequestBody?.tools)).toBe(true);
    expect((lastRequestBody?.tools as unknown[])?.length).toBe(1);
  });

  it("accumulates tool_calls deltas by index and emits tool_use_start + tool_use_delta (no adapter)", async () => {
    // OpenAI-compat dialect: name + opening JSON arrive in the first delta,
    // remaining arguments stream across subsequent deltas, finish_reason
    // = "tool_calls" terminates.
    nextStreamFrames = [
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_abc",
                  function: { name: "web_search", arguments: '{"q":"' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: 'reactive agents' } },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"}' } }],
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      }),
    ];

    const events = await runWith(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const s = yield* llm.stream({
          messages: [{ role: "user", content: "search" }],
          model: "openai/gpt-4o-mini",
        });
        return yield* drainEvents(s);
      }),
    );

    const startEvents = events.filter((e) => e.type === "tool_use_start");
    const deltaEvents = events.filter((e) => e.type === "tool_use_delta");

    expect(startEvents.length).toBe(1);
    expect(
      (startEvents[0] as { type: "tool_use_start"; id: string; name: string })
        .name,
    ).toBe("web_search");
    expect(deltaEvents.length).toBeGreaterThanOrEqual(3);

    // Concatenated deltas reconstruct full arguments.
    const concatenated = deltaEvents
      .map((e) => (e as { type: "tool_use_delta"; input: string }).input)
      .join("");
    expect(concatenated).toBe('{"q":"reactive agents"}');
  });

  it("adapter normalization: per-chunk emissions suppressed; one synthesized pair at finish_reason", async () => {
    overrideAdapter = {
      parseToolCalls: () => [
        { name: "normalized_tool", arguments: { adapter: true } },
      ],
    };

    nextStreamFrames = [
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_raw",
                  function: { name: "raw_tool", arguments: '{"r":1}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }),
    ];

    const events = await runWith(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const s = yield* llm.stream({
          messages: [{ role: "user", content: "x" }],
          model: "openai/gpt-4o-mini",
        });
        return yield* drainEvents(s);
      }),
    );

    const startEvents = events.filter((e) => e.type === "tool_use_start");
    const deltaEvents = events.filter((e) => e.type === "tool_use_delta");

    // Adapter path: exactly one start+delta synthesized at end-of-stream
    // (not three deltas trickled through during accumulation).
    expect(startEvents.length).toBe(1);
    expect(deltaEvents.length).toBe(1);
    expect(
      (startEvents[0] as { type: "tool_use_start"; name: string }).name,
    ).toBe("normalized_tool");
    expect(
      (deltaEvents[0] as { type: "tool_use_delta"; input: string }).input,
    ).toBe('{"adapter":true}');
  });

  it("emits usage event with calculated cost on stream end", async () => {
    nextStreamFrames = [
      JSON.stringify({
        choices: [{ delta: { content: "hi" }, finish_reason: null }],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    ];

    const events = await runWith(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const s = yield* llm.stream({
          messages: [{ role: "user", content: "hi" }],
          model: "openai/gpt-4o-mini",
        });
        return yield* drainEvents(s);
      }),
    );

    const usageEvent = events.find((e) => e.type === "usage");
    expect(usageEvent).toBeDefined();
    const usage = (usageEvent as {
      type: "usage";
      usage: { inputTokens: number; outputTokens: number; totalTokens: number };
    }).usage;
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
    expect(usage.totalTokens).toBe(150);
  });
});
