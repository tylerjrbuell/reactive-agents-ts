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
  embeddings: [
    [0.1, 0.2, 0.3],
    [0.4, 0.5, 0.6],
  ],
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

describe("OllamaProviderLive (ollama SDK)", () => {
  it("complete() returns mapped CompletionResponse", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Hello" }],
        });
      }),
    );

    expect(result.content).toBe("Hello from Ollama mock");
    expect(result.stopReason).toBe("end_turn");
    expect(result.model).toBe("cogito:14b");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.usage.estimatedCost).toBe(0);
  });

  it("complete() passes tools to SDK when provided", async () => {
    await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Search for test" }],
          tools: [
            {
              name: "search",
              description: "Search the web",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          ],
        });
      }),
    );

    const callArgs = mockChat.mock.calls.at(-1)?.[0] as {
      tools?: unknown[];
    };
    expect(callArgs.tools).toBeDefined();
    expect(callArgs.tools!.length).toBe(1);
    expect((callArgs.tools![0] as any).type).toBe("function");
    expect((callArgs.tools![0] as any).function.name).toBe("search");
  });

  it("complete() parses tool_calls from response", async () => {
    mockChat.mockImplementationOnce(async (_opts: unknown) => ({
      model: "cogito:14b",
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "search",
              arguments: { query: "test" },
            },
          },
        ],
      },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 8,
      eval_count: 3,
    }));

    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Search for test" }],
          tools: [
            {
              name: "search",
              description: "Search the web",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
              },
            },
          ],
        });
      }),
    );

    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(1);
    expect(result.toolCalls![0].name).toBe("search");
    expect((result.toolCalls![0].input as any).query).toBe("test");
  });

  it("complete() maps done_reason correctly", async () => {
    mockChat.mockImplementationOnce(
      async () =>
        ({
          model: "cogito:14b",
          message: {
            role: "assistant",
            content: "truncated",
            tool_calls: undefined,
          },
          done: true,
          done_reason: "length",
          prompt_eval_count: 4,
          eval_count: 2,
        }) as any,
    );

    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "long prompt" }],
        });
      }),
    );

    expect(result.stopReason).toBe("max_tokens");
  });

  it("embed() returns embeddings via SDK", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.embed(["text one", "text two"]);
      }),
    );

    expect(result.length).toBe(2);
    expect(result[0]).toEqual([0.1, 0.2, 0.3]);
    expect(result[1]).toEqual([0.4, 0.5, 0.6]);
  });

  it("getModelConfig() returns ollama provider", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.getModelConfig();
      }),
    );

    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("cogito:14b");
  });

  it("complete() does not pass think param when config.thinking is false", async () => {
    const configWithNoThinking = LLMConfig.of({
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
      thinking: false,
    });

    const layer = LocalProviderLive.pipe(
      Layer.provide(Layer.succeed(LLMConfig, configWithNoThinking)),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Hello" }],
        });
      }).pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
    );

    const callArgs = mockChat.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    // think should NOT be passed when config.thinking is false
    expect(callArgs.think).toBeUndefined();
  });

  it("complete() passes think:true when config.thinking is true", async () => {
    const configWithThinking = LLMConfig.of({
      defaultProvider: "ollama",
      defaultModel: "qwen3.5",
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
      thinking: true,
    });

    const layer = LocalProviderLive.pipe(
      Layer.provide(Layer.succeed(LLMConfig, configWithThinking)),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Hello" }],
        });
      }).pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
    );

    const callArgs = mockChat.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(callArgs.think).toBe(true);
  });

  it("complete() auto-detects thinking via /api/show when config.thinking is undefined", async () => {
    // Mock show to return a template with thinking support
    mockShow.mockImplementationOnce(async () => ({
      template: "some template with think tag support",
    }));

    const configAutoDetect = LLMConfig.of({
      defaultProvider: "ollama",
      defaultModel: "qwen3.5",
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
      // thinking: undefined — auto-detect
    });

    const layer = LocalProviderLive.pipe(
      Layer.provide(Layer.succeed(LLMConfig, configAutoDetect)),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Hello" }],
        });
      }).pipe(Effect.provide(layer as Layer.Layer<LLMServiceType, unknown>)),
    );

    // Should have called show() to check thinking capability
    expect(mockShow).toHaveBeenCalled();
  });
});
