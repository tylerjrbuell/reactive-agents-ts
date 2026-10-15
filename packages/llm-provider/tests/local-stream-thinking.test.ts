// Run: bun test packages/llm-provider/tests/local-stream-thinking.test.ts --timeout 15000
//
// Wave 1.2 (Local-Tier Reliability program) — the thinking channel on the
// streaming wire protocol. Live-verified root cause: a raw qwen3:4b stream
// carries 393 thinking chunks / 1,213 chars, but the framework's stream loop
// forwarded only content + tool_calls, so think.ts's providerThinking /
// rescueFromThinking starved (0 thinking events). complete() already extracts
// `message.thinking` (symmetry reference, local.ts complete path) — this suite
// pins the streaming half:
//   (1) `thinking_delta` events emitted per chunk in the SAME accumulation
//       pass as content, and full accumulated thinking attached to
//       `content_complete.thinking` (additive optional field);
//   (2) emission is gated by the EXISTING thinking-capability seam — a model
//       whose capability says supportsThinkingMode=false produces ZERO
//       thinking_delta events even if rogue chunks carry `thinking`.

import { describe, it, expect, mock, afterAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

// ─── Mock the `ollama` package BEFORE the provider module is imported ───
// Bun module mocks are process-global and leak across test FILES. Capture the
// real module and re-install it in afterAll so later files hit the real SDK.
const realOllamaModule = { ...(await import("ollama")) };
afterAll(() => {
  mock.module("ollama", () => realOllamaModule);
});

type MockChunk = Record<string, unknown>;

/** Chat-stream chunks the mock `chat({stream:true})` will iterate. */
let streamChunks: MockChunk[] = [];

const makeMockStream = () => {
  const stream: AsyncIterable<MockChunk> & { abort: () => void } = {
    abort: () => {},
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of streamChunks) {
        yield chunk;
      }
    },
  };
  return stream;
};

mock.module("ollama", () => ({
  Ollama: class MockOllama {
    constructor(_opts?: { host?: string; fetch?: typeof fetch }) {}
    chat = async (_opts: unknown) => makeMockStream();
    show = async (_opts: { model: string }) => ({ capabilities: [] });
    embed = async (_opts: unknown) => ({ embeddings: [[0.1]] });
  },
}));

const { LocalProviderLive } = await import("../src/providers/local.js");
import { LLMService } from "../src/llm-service.js";
import { LLMConfig } from "../src/llm-config.js";
import type { StreamEvent } from "../src/types.js";

const makeConfig = (overrides: Partial<{ thinking: boolean }> = {}) =>
  Layer.succeed(LLMConfig, {
    defaultProvider: "ollama" as const,
    defaultModel: "qwen3:4b",
    ollamaEndpoint: "http://localhost:11434",
    timeoutMs: 30_000,
    maxRetries: 0,
    defaultMaxTokens: 128,
    defaultTemperature: 0.1,
    observabilityVerbosity: "metadata" as const,
    embeddingConfig: { model: "nomic-embed-text", dimensions: 1, provider: "ollama" as const },
    supportsPromptCaching: false,
    pricingRegistry: {},
    ...overrides,
  } as unknown as LLMConfig["Type"]);

const collectStream = (
  request: Parameters<LLMService["Type"]["stream"]>[0],
  configLayer = makeConfig(),
): Promise<StreamEvent[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const stream = yield* llm.stream(request);
      return Array.from(
        yield* Stream.runCollect(stream).pipe(
          Effect.mapError((e) => e as Error),
        ),
      );
    }).pipe(
      Effect.provide(LocalProviderLive.pipe(Layer.provide(configLayer))),
    ),
  );

const doneChunk: MockChunk = {
  done: true,
  done_reason: "stop",
  message: { role: "assistant", content: "" },
  prompt_eval_count: 10,
  eval_count: 12,
};

describe("local stream — thinking channel (Wave 1.2)", () => {
  it("emits thinking_delta per thinking chunk and attaches accumulated thinking to content_complete", async () => {
    // Mirrors the live-verified qwen3:4b wire shape: thinking arrives in
    // message.thinking chunks before/interleaved with visible content.
    streamChunks = [
      { message: { role: "assistant", content: "", thinking: "Let me " } },
      { message: { role: "assistant", content: "", thinking: "think. " } },
      { message: { role: "assistant", content: "The answer is 4." } },
      doneChunk,
    ];

    const events = await collectStream({
      messages: [{ role: "user", content: "2+2?" }],
      model: "qwen3:4b", // static table: supportsThinkingMode = true
    });

    const thinkingDeltas = events.filter((e) => e.type === "thinking_delta");
    expect(thinkingDeltas.length).toBe(2);
    if (thinkingDeltas[0]?.type !== "thinking_delta") throw new Error("expected thinking_delta");
    if (thinkingDeltas[1]?.type !== "thinking_delta") throw new Error("expected thinking_delta");
    expect(thinkingDeltas[0].thinking).toBe("Let me ");
    expect(thinkingDeltas[1].thinking).toBe("think. ");

    const complete = events.find((e) => e.type === "content_complete");
    expect(complete?.type).toBe("content_complete");
    if (complete?.type !== "content_complete") throw new Error("expected content_complete");
    expect(complete.content).toBe("The answer is 4.");
    expect(complete.thinking).toBe("Let me think. ");
  }, 15000);

  it("emits ZERO thinking_delta for a model whose capability lacks thinking mode", async () => {
    // Gate seam: the SAME capability check complete()'s widening logic uses
    // (resolveThinking / supportsThinkingMode). cogito:14b is a static-table
    // entry with supportsThinkingMode=false.
    streamChunks = [
      { message: { role: "assistant", content: "", thinking: "rogue thinking" } },
      { message: { role: "assistant", content: "plain answer" } },
      doneChunk,
    ];

    const events = await collectStream({
      messages: [{ role: "user", content: "hi" }],
      model: "cogito:14b",
    });

    expect(events.filter((e) => e.type === "thinking_delta").length).toBe(0);
    const complete = events.find((e) => e.type === "content_complete");
    if (complete?.type !== "content_complete") throw new Error("expected content_complete");
    expect(complete.content).toBe("plain answer");
    expect((complete as { thinking?: string }).thinking).toBeUndefined();
  }, 15000);

  it("emits thinking when config.thinking is explicitly true and the model is capable", async () => {
    // Opt-in arm: think:true → resolveThinking probes /api/show (mocked
    // capable below via per-file show). Uses a distinct model name so the
    // process-global thinkingCapabilityCache cannot cross-contaminate arms.
    streamChunks = [
      { message: { role: "assistant", content: "", thinking: "reasoning " } },
      { message: { role: "assistant", content: "", thinking: "here" } },
      { message: { role: "assistant", content: "done" } },
      doneChunk,
    ];

    mock.module("ollama", () => ({
      Ollama: class MockOllama {
        constructor(_opts?: { host?: string; fetch?: typeof fetch }) {}
        chat = async (_opts: unknown) => makeMockStream();
        show = async (_opts: { model: string }) => ({ capabilities: ["completion", "thinking"] });
        embed = async (_opts: unknown) => ({ embeddings: [[0.1]] });
      },
    }));

    const events = await collectStream(
      {
        messages: [{ role: "user", content: "think hard" }],
        model: "test-thinking-explicit-1",
      },
      makeConfig({ thinking: true }),
    );

    expect(events.filter((e) => e.type === "thinking_delta").length).toBe(2);
    const complete = events.find((e) => e.type === "content_complete");
    if (complete?.type !== "content_complete") throw new Error("expected content_complete");
    expect(complete.thinking).toBe("reasoning here");
  }, 15000);
});
