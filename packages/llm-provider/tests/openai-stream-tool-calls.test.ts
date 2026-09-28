// Run: bun test packages/llm-provider/tests/openai-stream-tool-calls.test.ts --timeout 15000
//
// OpenAI stream() tool_calls accumulation + adapter wiring parity.
//
// Mirrors the two core cases in litellm-stream-tool-calls.test.ts now that the
// per-index accumulator + adapter-normalized finish synthesis live in the
// shared `src/stream-tool-call-accumulator.ts`:
//
//   1. no-adapter: per-chunk tool_use_start + progressive tool_use_delta whose
//      concatenation reconstructs the full argument JSON
//   2. adapter-normalized: per-chunk emissions suppressed; exactly one
//      start+delta pair synthesized at finish_reason
//
// Transport is the `openai` SDK mocked with an async generator of chunk
// objects (the seam used by openai-nonok-guard.test.ts / openai-cache-usage
// .test.ts). A real-SDK + `globalThis.fetch` approach is NOT usable here:
// `mock.module` is process-global and leaks across test files (see
// provider-adapter-wiring.test.ts:102), so a preceding suite's plain-object
// `openai` mock would shadow the real SDK. This seam yields 0 casts.

import { describe, it, expect, mock, beforeAll, afterEach } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import type { ProviderAdapter } from "../src/adapter.js";
import {
  localModelAdapter,
  defaultAdapter,
  midModelAdapter,
  selectAdapter,
  composeAdapters,
} from "../src/adapter.js";
import type { StreamEvent } from "../src/types.js";

// Adapter override seam (mirrors litellm-stream-tool-calls.test.ts and
// provider-adapter-wiring.test.ts). Delegates to the REAL selectAdapter when no
// override is active — `passthroughSelectAdapter` is captured before
// mock.module installs, so there is no recursion.
let overrideAdapter: ProviderAdapter | null = null;

const passthroughSelectAdapter = selectAdapter;

mock.module("../src/adapter.js", () => ({
  localModelAdapter,
  defaultAdapter,
  midModelAdapter,
  composeAdapters,
  selectAdapter: (
    caps: { supportsToolCalling: boolean },
    tier?: string,
    modelId?: string,
  ) => {
    if (overrideAdapter) return { adapter: overrideAdapter };
    return passthroughSelectAdapter(caps, tier, modelId);
  },
}));

// Chunks the mocked openai SDK will stream. Each entry is one
// `choices[0].delta` payload (OpenAI-compat dialect).
let nextStreamChunks: ReadonlyArray<unknown> = [];

async function* streamFromChunks() {
  for (const chunk of nextStreamChunks) yield chunk;
}

const mockCreate = mock(async (opts: { stream?: boolean }) => {
  if (opts?.stream) return streamFromChunks();
  return {
    choices: [
      {
        message: { content: "", role: "assistant", tool_calls: undefined },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    model: "gpt-4o",
  };
});

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    embeddings = { create: async () => ({ data: [] }) };
  },
}));

import type { LLMService as LLMServiceType } from "../src/index.js";

let OpenAIProviderLive: Layer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  OpenAIProviderLive = mod.OpenAIProviderLive as Layer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

afterEach(() => {
  overrideAdapter = null;
  nextStreamChunks = [];
});

const makeOpenAILayer = () =>
  OpenAIProviderLive.pipe(
    Layer.provide(
      Layer.succeed(
        LLMConfig,
        LLMConfig.of({
          defaultProvider: "openai",
          defaultModel: "gpt-4o",
          openaiApiKey: "test-key",
          defaultMaxTokens: 1024,
          defaultTemperature: 0.7,
          supportsPromptCaching: false,
          maxRetries: 1,
          timeoutMs: 30_000,
          embeddingConfig: {
            model: "text-embedding-3-small",
            dimensions: 3,
            provider: "openai",
            batchSize: 100,
          },
        }),
      ),
    ),
  );

const runWith = <A>(eff: Effect.Effect<A, unknown, LLMServiceType>) =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(makeOpenAILayer() as Layer.Layer<LLMServiceType, unknown>),
    ),
  );

const drainEvents = (
  stream: Stream.Stream<StreamEvent, unknown>,
): Effect.Effect<StreamEvent[], unknown, never> =>
  Stream.runCollect(stream).pipe(Effect.map((chunk) => Array.from(chunk)));

describe("OpenAI stream() — tool_calls + adapter wiring", () => {
  it("accumulates tool_calls deltas by index and emits tool_use_start + tool_use_delta (no adapter)", async () => {
    // OpenAI-compat dialect: name + opening JSON arrive in the first delta,
    // remaining arguments stream across subsequent deltas, finish_reason
    // = "tool_calls" terminates.
    nextStreamChunks = [
      {
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
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: "reactive agents" } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"}' } }],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      },
    ];

    const events = await runWith(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const s = yield* llm.stream({
          messages: [{ role: "user", content: "search" }],
          model: "gpt-4o",
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

    nextStreamChunks = [
      {
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
      },
      {
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      },
    ];

    const events = await runWith(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const s = yield* llm.stream({
          messages: [{ role: "user", content: "x" }],
          model: "gpt-4o",
        });
        return yield* drainEvents(s);
      }),
    );

    const startEvents = events.filter((e) => e.type === "tool_use_start");
    const deltaEvents = events.filter((e) => e.type === "tool_use_delta");

    // Adapter path: exactly one start+delta synthesized at end-of-stream
    // (not trickled through during accumulation).
    expect(startEvents.length).toBe(1);
    expect(deltaEvents.length).toBe(1);
    expect(
      (startEvents[0] as { type: "tool_use_start"; name: string }).name,
    ).toBe("normalized_tool");
    expect(
      (deltaEvents[0] as { type: "tool_use_delta"; input: string }).input,
    ).toBe('{"adapter":true}');
  });
});
