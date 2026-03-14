import { describe, it, expect, mock, beforeAll } from "bun:test";
import { Effect, Layer } from "effect";

// ─── Mock the `ollama` package BEFORE provider module is imported ───

const mockChat = mock(async (_opts: unknown) => ({
  model: "cogito:14b",
  message: {
    role: "assistant",
    content: "Hello from Ollama mock",
    tool_calls: undefined as
      | Array<{ function: { name: string; arguments: unknown } }>
      | undefined,
  },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 10,
  eval_count: 5,
}));

const mockEmbed = mock(async (_opts: unknown) => ({
  embeddings: [[0.1, 0.2, 0.3]],
}));

const mockShow = mock(async (_opts: { model: string }) => ({
  template: "default template without thinking",
}));

mock.module("ollama", () => ({
  Ollama: class MockOllama {
    constructor(_opts?: { host?: string }) {}
    chat = mockChat;
    embed = mockEmbed;
    show = mockShow;
  },
}));

// ─── Lazily resolved imports ───
import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";
import type { TokenLogprob, CompletionRequest, CompletionResponse } from "../src/types.js";

let LocalProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMConfig: (typeof import("../src/index.js"))["LLMConfig"];
let LLMService: (typeof import("../src/index.js"))["LLMService"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  LocalProviderLive =
    mod.LocalProviderLive as EffectLayer.Layer<LLMServiceType>;
  LLMConfig = mod.LLMConfig;
  LLMService = mod.LLMService;
});

// ─── Test helper ───

const makeTestLayer = () => {
  const testConfig = LLMConfig.of({
    defaultProvider: "ollama",
    defaultModel: "cogito:14b",
    ollamaEndpoint: "http://localhost:11434",
    embeddingConfig: {
      model: "nomic-embed-text",
      dimensions: 3,
      provider: "ollama",
      batchSize: 100,
    },
    supportsPromptCaching: false,
    maxRetries: 1,
    timeoutMs: 30_000,
    defaultMaxTokens: 1024,
    defaultTemperature: 0.7,
  });

  return LocalProviderLive.pipe(
    Layer.provide(Layer.succeed(LLMConfig, testConfig)),
  );
};

const run = <A>(effect: Effect.Effect<A, unknown, LLMServiceType>) => {
  const layer = makeTestLayer();
  return Effect.runPromise(
    effect.pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
  );
};

// ─── Tests ───

describe("Logprobs support", () => {
  describe("CompletionRequest type", () => {
    it("accepts logprobs and topLogprobs fields", () => {
      // Type-level test — if this compiles, the fields exist on CompletionRequest
      const request: CompletionRequest = {
        messages: [{ role: "user", content: "Hello" }],
        logprobs: true,
        topLogprobs: 5,
      };

      expect(request.logprobs).toBe(true);
      expect(request.topLogprobs).toBe(5);
    });
  });

  describe("CompletionResponse type", () => {
    it("includes optional logprobs field with TokenLogprob[]", () => {
      // Type-level test — if this compiles, logprobs exists on CompletionResponse
      const response: CompletionResponse = {
        content: "Paris",
        stopReason: "end_turn",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          estimatedCost: 0,
        },
        model: "test-model",
        logprobs: [
          {
            token: "Paris",
            logprob: -0.0234,
            topLogprobs: [
              { token: "Paris", logprob: -0.0234 },
              { token: "London", logprob: -3.89 },
            ],
          },
        ],
      };

      expect(response.logprobs).toBeDefined();
      expect(response.logprobs!.length).toBe(1);
      expect(response.logprobs![0].token).toBe("Paris");
      expect(response.logprobs![0].logprob).toBe(-0.0234);
      expect(response.logprobs![0].topLogprobs).toBeDefined();
      expect(response.logprobs![0].topLogprobs!.length).toBe(2);
    });

    it("logprobs is undefined when not provided", () => {
      const response: CompletionResponse = {
        content: "Hello",
        stopReason: "end_turn",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          estimatedCost: 0,
        },
        model: "test-model",
      };

      expect(response.logprobs).toBeUndefined();
    });
  });

  describe("TokenLogprob type", () => {
    it("supports token, logprob, and optional topLogprobs", () => {
      const lp: TokenLogprob = {
        token: "hello",
        logprob: -1.5,
      };
      expect(lp.token).toBe("hello");
      expect(lp.logprob).toBe(-1.5);
      expect(lp.topLogprobs).toBeUndefined();

      const lpWithTop: TokenLogprob = {
        token: "world",
        logprob: -0.5,
        topLogprobs: [
          { token: "world", logprob: -0.5 },
          { token: "earth", logprob: -2.3 },
        ],
      };
      expect(lpWithTop.topLogprobs).toBeDefined();
      expect(lpWithTop.topLogprobs!.length).toBe(2);
    });
  });

  describe("Ollama adapter", () => {
    it("passes logprobs options to Ollama SDK", async () => {
      await run(
        Effect.gen(function* () {
          const llm = yield* LLMService;
          return yield* llm.complete({
            messages: [{ role: "user", content: "Hello" }],
            logprobs: true,
            topLogprobs: 3,
          });
        }),
      );

      const callArgs = mockChat.mock.calls.at(-1)?.[0] as {
        options?: { logprobs?: boolean; top_logprobs?: number };
      };
      expect(callArgs.options?.logprobs).toBe(true);
      expect(callArgs.options?.top_logprobs).toBe(3);
    });

    it("does not pass logprobs options when not requested", async () => {
      await run(
        Effect.gen(function* () {
          const llm = yield* LLMService;
          return yield* llm.complete({
            messages: [{ role: "user", content: "Hello" }],
          });
        }),
      );

      const callArgs = mockChat.mock.calls.at(-1)?.[0] as {
        options?: Record<string, unknown>;
      };
      expect(callArgs.options?.logprobs).toBeUndefined();
      expect(callArgs.options?.top_logprobs).toBeUndefined();
    });

    it("extracts logprobs from Ollama response", async () => {
      mockChat.mockImplementationOnce(async (_opts: unknown) => ({
        model: "cogito:14b",
        message: {
          role: "assistant",
          content: "Paris",
          tool_calls: undefined,
        },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 10,
        eval_count: 5,
        logprobs: [
          {
            token: "Paris",
            logprob: -0.023,
            top_logprobs: [
              { token: "Paris", logprob: -0.023 },
              { token: "London", logprob: -3.89 },
            ],
          },
        ],
      }));

      const result = await run(
        Effect.gen(function* () {
          const llm = yield* LLMService;
          return yield* llm.complete({
            messages: [{ role: "user", content: "Capital of France?" }],
            logprobs: true,
            topLogprobs: 2,
          });
        }),
      );

      expect(result.logprobs).toBeDefined();
      expect(result.logprobs!.length).toBe(1);
      expect(result.logprobs![0].token).toBe("Paris");
      expect(result.logprobs![0].logprob).toBe(-0.023);
      expect(result.logprobs![0].topLogprobs).toBeDefined();
      expect(result.logprobs![0].topLogprobs!.length).toBe(2);
    });

    it("returns undefined logprobs when not in response", async () => {
      const result = await run(
        Effect.gen(function* () {
          const llm = yield* LLMService;
          return yield* llm.complete({
            messages: [{ role: "user", content: "Hello" }],
          });
        }),
      );

      expect(result.logprobs).toBeUndefined();
    });
  });
});
