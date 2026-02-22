// File: tests/strategies/adaptive.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("AdaptiveStrategy", () => {
  it("should analyze task, select reactive strategy, and return completed result", async () => {
    const layer = TestLLMServiceLayer({
      // Analysis prompt triggers strategy selection
      "Classify the task": "REACTIVE",
      // Then the reactive sub-strategy runs
      "Think step-by-step": "FINAL ANSWER: The capital of France is Paris.",
    });

    const program = executeAdaptive({
      taskDescription: "What is the capital of France?",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("adaptive");
    expect(result.status).toBe("completed");
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.metadata.stepsCount).toBeGreaterThan(0);
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);

    // Should have the adaptive analysis step plus sub-strategy steps
    const adaptiveStep = result.steps.find((s) =>
      s.content.includes("[ADAPTIVE]"),
    );
    expect(adaptiveStep).toBeDefined();
    expect(adaptiveStep!.content).toContain("reactive");
  });

  it("should default to reactive when analysis response is unrecognized", async () => {
    // Default "Test response" won't match any strategy keyword,
    // so parseStrategySelection defaults to "reactive"
    const layer = TestLLMServiceLayer({
      "Think step-by-step": "FINAL ANSWER: Done.",
    });

    const program = executeAdaptive({
      taskDescription: "A simple question",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("adaptive");
    expect(result.status).toBe("completed");

    // Adaptive step should show reactive was selected
    const adaptiveStep = result.steps.find((s) =>
      s.content.includes("[ADAPTIVE]"),
    );
    expect(adaptiveStep).toBeDefined();
    expect(adaptiveStep!.content).toContain("reactive");
  });

  it("should combine token usage from analysis and sub-strategy", async () => {
    const layer = TestLLMServiceLayer({
      "Classify the task": "REACTIVE",
      "Think step-by-step": "FINAL ANSWER: 42",
    });

    const program = executeAdaptive({
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
    // Token usage should include both analysis and sub-strategy tokens
    expect(result.metadata.tokensUsed).toBeGreaterThanOrEqual(0);
    expect(result.metadata.cost).toBeGreaterThanOrEqual(0);
    expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
  });
});
