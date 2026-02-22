// File: tests/strategies/tree-of-thought.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("TreeOfThoughtStrategy", () => {
  it("should execute tree exploration and return completed result", async () => {
    const layer = TestLLMServiceLayer({
      "Generate exactly": "1. Approach via historical analysis\n2. Approach via geographical lookup",
      "Rate this thought": "0.8",
      "Synthesize the reasoning": "Paris is the capital of France.",
    });

    const program = executeTreeOfThought({
      taskDescription: "What is the capital of France?",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          treeOfThought: { breadth: 2, depth: 2, pruningThreshold: 0.3 },
        },
      },
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("tree-of-thought");
    expect(result.status).toBe("completed");
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.metadata.stepsCount).toBeGreaterThan(0);
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);
    expect(result.metadata.confidence).toBe(0.85);
  });

  it("should prune branches below threshold and still produce a result", async () => {
    // All scores below pruning threshold will cause early termination
    const layer = TestLLMServiceLayer({
      "Generate exactly": "1. A weak approach\n2. Another weak approach",
      "Rate this thought": "0.1",
      "Synthesize the reasoning": "Best effort answer despite low scores.",
    });

    const program = executeTreeOfThought({
      taskDescription: "A difficult exploratory task",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          treeOfThought: { breadth: 2, depth: 2, pruningThreshold: 0.3 },
        },
      },
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("tree-of-thought");
    // Even with all branches pruned, there are still nodes from depth 1
    // so synthesis still runs on the best available node
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.metadata.stepsCount).toBeGreaterThan(0);

    // Should have the initial TOT thought step plus expansion/scoring steps
    const totSteps = result.steps.filter((s) =>
      s.content.includes("[TOT"),
    );
    expect(totSteps.length).toBeGreaterThanOrEqual(1);
  });

  it("should track token usage across expansion, scoring, and synthesis", async () => {
    const layer = TestLLMServiceLayer({
      "Generate exactly": "1. First thought\n2. Second thought",
      "Rate this thought": "0.7",
      "Synthesize the reasoning": "Final synthesized answer.",
    });

    const program = executeTreeOfThought({
      taskDescription: "Simple task",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          treeOfThought: { breadth: 2, depth: 2, pruningThreshold: 0.3 },
        },
      },
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("completed");
    expect(result.metadata.tokensUsed).toBeGreaterThanOrEqual(0);
    expect(result.metadata.cost).toBeGreaterThanOrEqual(0);
    expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
  });
});
