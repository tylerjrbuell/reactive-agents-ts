// File: tests/reasoning-service.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ReasoningService } from "../src/services/reasoning-service.js";
import { createReasoningLayer } from "../src/runtime.js";
import { defaultReasoningConfig } from "../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("ReasoningService", () => {
  const llmLayer = TestLLMServiceLayer({
    "Think step-by-step": "FINAL ANSWER: The answer is 42.",
  });

  const reasoningLayer = createReasoningLayer({
    ...defaultReasoningConfig,
    adaptive: { enabled: false, learning: false },
  });

  // Combine: reasoning needs LLMService
  const testLayer = Layer.provide(reasoningLayer, llmLayer);

  it("should execute with default reactive strategy", async () => {
    const program = Effect.gen(function* () {
      const reasoning = yield* ReasoningService;
      const result = yield* reasoning.execute({
        taskDescription: "What is 6 * 7?",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
      });

      expect(result.strategy).toBe("reactive");
      expect(result.status).toBe("completed");
      expect(result.steps.length).toBeGreaterThan(0);
    });

    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
  });

  it("should execute with explicit reactive strategy", async () => {
    const program = Effect.gen(function* () {
      const reasoning = yield* ReasoningService;
      const result = yield* reasoning.execute({
        taskDescription: "What is 6 * 7?",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        strategy: "reactive",
      });

      expect(result.strategy).toBe("reactive");
      expect(result.status).toBe("completed");
    });

    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
  });

  it("should fail when requesting unregistered strategy", async () => {
    const program = Effect.gen(function* () {
      const reasoning = yield* ReasoningService;
      return yield* reasoning.execute({
        taskDescription: "A task",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        strategy: "nonexistent-strategy" as any,
      });
    });

    const result = await Effect.runPromiseExit(
      program.pipe(Effect.provide(testLayer)),
    );

    expect(result._tag).toBe("Failure");
  });

  it("should allow registering and using a custom strategy", async () => {
    const program = Effect.gen(function* () {
      const reasoning = yield* ReasoningService;

      // Register a custom strategy
      yield* reasoning.registerStrategy("reflexion", (_input) =>
        Effect.succeed({
          strategy: "reflexion" as const,
          steps: [],
          output: "custom reflexion output",
          metadata: {
            duration: 10,
            cost: 0,
            tokensUsed: 0,
            stepsCount: 0,
            confidence: 0.95,
          },
          status: "completed" as const,
        }),
      );

      const result = yield* reasoning.execute({
        taskDescription: "A task",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        strategy: "reflexion",
      });

      expect(result.strategy).toBe("reflexion");
      expect(result.output).toBe("custom reflexion output");
    });

    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
  });
});
