// File: tests/strategies/reactive.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("ReactiveStrategy", () => {
  it("should execute ReAct loop and return completed result", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Think step-by-step", text: "FINAL ANSWER: The capital of France is Paris." },
    ]);

    const program = executeReactive({
      taskDescription: "What is the capital of France?",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("reactive");
    expect(result.status).toBe("completed");
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.metadata.stepsCount).toBeGreaterThan(0);
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);
  });

  it("should return partial result when max iterations reached", async () => {
    // This layer returns responses that never contain "FINAL ANSWER"
    const layer = TestLLMServiceLayer();
    // Default TestLLMService returns "Test response" which has no FINAL ANSWER

    const program = executeReactive({
      taskDescription: "An impossible task",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          reactive: { maxIterations: 3, temperature: 0.7 },
        },
      },
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    // Mock returns empty text each turn → no FINAL ANSWER, no tools → loop detection
    // fires on consecutive thought steps. Post-W4 (single-owner Arbitrator), an
    // unresolved loop with no progress is reported as "failed" rather than papered
    // over as "completed" — see AUDIT-overhaul-2026.md FIX-18 / W4.
    expect(result.status).toBe("failed");
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("should parse tool requests and add action + observation steps", async () => {
    let callCount = 0;
    const layer = TestLLMServiceLayer([
      { toolCall: { name: "search", args: { query: "capital of France" } } },
      { match: "search", text: "FINAL ANSWER: Paris is the capital of France." },
    ]);

    const program = executeReactive({
      taskDescription: "What is the capital of France?",
      taskType: "query",
      memoryContext: "",
      availableTools: ["search"],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          reactive: { maxIterations: 5, temperature: 0.7 },
        },
      },
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    // Should have thought + action + observation steps in the first iteration
    // then a final answer thought in the second iteration
    const thoughtSteps = result.steps.filter((s) => s.type === "thought");
    const actionSteps = result.steps.filter((s) => s.type === "action");
    const observationSteps = result.steps.filter(
      (s) => s.type === "observation",
    );

    expect(thoughtSteps.length).toBeGreaterThanOrEqual(1);
    expect(actionSteps.length).toBeGreaterThanOrEqual(1);
    expect(observationSteps.length).toBeGreaterThanOrEqual(1);

    // Action step should have toolUsed metadata
    const action = actionSteps[0];
    expect(action.metadata?.toolUsed).toBe("search");
  });

  it("should track token usage and cost across iterations", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Think step-by-step", text: "FINAL ANSWER: Done." },
    ]);

    const program = executeReactive({
      taskDescription: "Simple task",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.metadata.tokensUsed).toBeGreaterThanOrEqual(0);
    expect(result.metadata.cost).toBeGreaterThanOrEqual(0);
    expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
  });

  it("should complete on first iteration when LLM gives final answer immediately", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Think step-by-step", text: "FINAL ANSWER: 42" },
    ]);

    const program = executeReactive({
      taskDescription: "What is the answer?",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("completed");
    expect(result.steps.length).toBe(1); // Just one thought step
    expect(result.metadata.confidence).toBe(0.8);
  });
});
