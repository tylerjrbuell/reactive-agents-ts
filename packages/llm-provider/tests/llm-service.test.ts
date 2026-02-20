import { describe, it, expect } from "bun:test";
import { Effect, Stream } from "effect";
import { LLMService, TestLLMServiceLayer } from "../src/index.js";

const TestLayer = TestLLMServiceLayer({
  "capital of France": "Paris is the capital of France.",
  "quantum": "Quantum computing uses qubits for parallel computation.",
});

const run = <A>(effect: Effect.Effect<A, unknown, LLMService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

describe("LLMService (TestLLMService)", () => {
  it("should complete with pattern-matched response", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "What is the capital of France?" }],
        });
      }),
    );

    expect(result.content).toBe("Paris is the capital of France.");
    expect(result.stopReason).toBe("end_turn");
    expect(result.model).toBe("test-model");
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.usage.estimatedCost).toBe(0);
  });

  it("should return default response when no pattern matches", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "Hello world" }],
        });
      }),
    );

    expect(result.content).toBe("Test response");
  });

  it("should stream text deltas", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const stream = yield* llm.stream({
          messages: [{ role: "user", content: "Hello" }],
        });
        return yield* Stream.runCollect(stream);
      }),
    );

    const events = Array.from(result);
    expect(events.length).toBeGreaterThan(0);

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBeGreaterThan(0);

    const complete = events.find((e) => e.type === "content_complete");
    expect(complete).toBeDefined();
  });

  it("should generate embeddings", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.embed(["hello world", "test embedding"]);
      }),
    );

    expect(result.length).toBe(2);
    expect(result[0]!.length).toBe(768);
    expect(result[1]!.length).toBe(768);
  });

  it("should count tokens", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.countTokens([
          { role: "user", content: "Hello world" },
          { role: "assistant", content: "Hi there" },
        ]);
      }),
    );

    expect(result).toBeGreaterThan(0);
  });

  it("should get model config", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.getModelConfig();
      }),
    );

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("test-model");
  });

  it("should have correct response field names (API contract)", async () => {
    const result = await run(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({
          messages: [{ role: "user", content: "quantum" }],
        });
      }),
    );

    // Verify API contract fields
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("stopReason");
    expect(result).toHaveProperty("usage");
    expect(result).toHaveProperty("model");
    expect(result.usage).toHaveProperty("inputTokens");
    expect(result.usage).toHaveProperty("outputTokens");
    expect(result.usage).toHaveProperty("totalTokens");
    expect(result.usage).toHaveProperty("estimatedCost");

    // These should NOT exist
    expect(result).not.toHaveProperty("text");
    expect(result).not.toHaveProperty("result");
    expect(result.usage).not.toHaveProperty("cost");
  });
});
