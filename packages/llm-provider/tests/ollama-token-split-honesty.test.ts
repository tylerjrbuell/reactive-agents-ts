// packages/llm-provider/tests/ollama-token-split-honesty.test.ts
// Token-split honesty (2026-11): local.ts reported `prompt_eval_count ?? 0` and
// `eval_count ?? 0` on complete() and on the streamed usage event. An absent
// count read as a MEASURED zero. Fixed so an absent half is `undefined` (unknown),
// a present 0 stays 0, and a partial report never fabricates the missing half.
//
// Run: bun test packages/llm-provider/tests/ollama-token-split-honesty.test.ts --timeout 15000

import { describe, it, expect, mock, afterAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";

const realOllamaModule = { ...(await import("ollama")) };
afterAll(() => {
  mock.module("ollama", () => realOllamaModule);
});

type MockChunk = Record<string, unknown>;

/** Non-stream chat response (complete() path). */
let completeResponse: MockChunk = {};
/** Stream chunks (stream() path). */
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
    chat = async (opts: { stream?: boolean }) =>
      opts.stream === true ? makeMockStream() : completeResponse;
    show = async (_opts: { model: string }) => ({ capabilities: [] });
    embed = async (_opts: unknown) => ({ embeddings: [[0.1]] });
  },
}));

const { LocalProviderLive } = await import("../src/providers/local.js");
import { LLMService } from "../src/llm-service.js";
import { LLMConfig } from "../src/llm-config.js";
import type { StreamEvent, TokenUsage } from "../src/types.js";
import { makeLLMConfig } from "./helpers/llm-config.js";

const configLayer = Layer.succeed(
  LLMConfig,
  makeLLMConfig({
    defaultProvider: "ollama",
    defaultModel: "llama3.2",
    ollamaEndpoint: "http://localhost:11434",
  }),
);

const providerLayer = LocalProviderLive.pipe(Layer.provide(configLayer));

const runComplete = (): Promise<TokenUsage> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const res = yield* llm.complete({
        messages: [{ role: "user", content: "hi" }],
        model: "llama3.2",
      });
      return res.usage;
    }).pipe(Effect.provide(providerLayer)),
  );

const runStreamUsage = (): Promise<TokenUsage | undefined> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const stream = yield* llm.stream({
        messages: [{ role: "user", content: "hi" }],
        model: "llama3.2",
      });
      const events: StreamEvent[] = Array.from(yield* Stream.runCollect(stream));
      const usage = events.find((e) => e.type === "usage");
      return usage?.type === "usage" ? usage.usage : undefined;
    }).pipe(Effect.provide(providerLayer)),
  );

const contentChunk: MockChunk = {
  message: { role: "assistant", content: "ok" },
};

describe("Ollama complete() token honesty", () => {
  it("absent prompt_eval_count and eval_count are undefined, not 0", async () => {
    completeResponse = {
      model: "llama3.2",
      message: { role: "assistant", content: "ok" },
      done: true,
      done_reason: "stop",
    };
    const usage = await runComplete();
    expect(usage.inputTokens).toBeUndefined();
    expect(usage.outputTokens).toBeUndefined();
  });

  it("present zero stays 0 (measured, not unknown)", async () => {
    completeResponse = {
      model: "llama3.2",
      message: { role: "assistant", content: "ok" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 0,
      eval_count: 0,
    };
    const usage = await runComplete();
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
  });

  it("partial report: absent eval_count stays undefined, not derived", async () => {
    completeResponse = {
      model: "llama3.2",
      message: { role: "assistant", content: "ok" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 12,
    };
    const usage = await runComplete();
    expect(usage.inputTokens).toBe(12);
    expect(usage.outputTokens).toBeUndefined();
  });
});

describe("Ollama stream() usage honesty", () => {
  it("absent counts on the done chunk are undefined, not 0", async () => {
    streamChunks = [contentChunk, { done: true, done_reason: "stop", message: { role: "assistant", content: "" } }];
    const usage = await runStreamUsage();
    expect(usage).toBeDefined();
    expect(usage?.inputTokens).toBeUndefined();
    expect(usage?.outputTokens).toBeUndefined();
  });

  it("present zero stays 0 on the stream usage event", async () => {
    streamChunks = [
      contentChunk,
      { done: true, done_reason: "stop", message: { role: "assistant", content: "" }, prompt_eval_count: 0, eval_count: 0 },
    ];
    const usage = await runStreamUsage();
    expect(usage?.inputTokens).toBe(0);
    expect(usage?.outputTokens).toBe(0);
  });

  it("partial stream report: absent eval_count stays undefined, not derived", async () => {
    streamChunks = [
      contentChunk,
      { done: true, done_reason: "stop", message: { role: "assistant", content: "" }, prompt_eval_count: 9 },
    ];
    const usage = await runStreamUsage();
    expect(usage?.inputTokens).toBe(9);
    expect(usage?.outputTokens).toBeUndefined();
  });
});
