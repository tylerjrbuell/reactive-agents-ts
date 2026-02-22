// File: tests/strategies/plan-execute.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("PlanExecuteStrategy", () => {
  it("should execute plan-execute-reflect loop and return completed result", async () => {
    const layer = TestLLMServiceLayer({
      "Create a step-by-step plan":
        "1. Research the topic\n2. Summarize findings\n3. Provide the answer",
      "Execute this step": "Step executed successfully with relevant findings.",
      "evaluating plan execution":
        "SATISFIED: All steps were executed successfully and the task is complete.",
    });

    const program = executePlanExecute({
      taskDescription: "What is the capital of France?",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("plan-execute-reflect");
    expect(result.status).toBe("completed");
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.metadata.stepsCount).toBeGreaterThan(0);
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);
  });

  it("should return partial result when max refinements reached without satisfaction", async () => {
    // Default TestLLMService returns "Test response" which won't match SATISFIED:
    // But we need numbered steps for the plan parser
    const layer = TestLLMServiceLayer({
      "planning agent":
        "1. Investigate the problem\n2. Analyze results",
    });

    const program = executePlanExecute({
      taskDescription: "An impossible task",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          planExecute: { maxRefinements: 1, reflectionDepth: "shallow" },
        },
      },
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("plan-execute-reflect");
    // After exhausting refinements without SATISFIED:, should still produce output
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.metadata.stepsCount).toBeGreaterThan(0);

    // Should have plan, execution, and reflection steps
    const planSteps = result.steps.filter((s) =>
      s.content.startsWith("[PLAN"),
    );
    const execSteps = result.steps.filter((s) =>
      s.content.startsWith("[EXEC"),
    );
    const reflectSteps = result.steps.filter((s) =>
      s.content.startsWith("[REFLECT"),
    );

    expect(planSteps.length).toBeGreaterThanOrEqual(1);
    expect(execSteps.length).toBeGreaterThanOrEqual(1);
    expect(reflectSteps.length).toBeGreaterThanOrEqual(1);
  });

  it("should track token usage and cost across plan-execute-reflect cycle", async () => {
    const layer = TestLLMServiceLayer({
      "planning agent":
        "1. Look up the answer",
      "Execute this step": "The answer is 42.",
      "evaluating plan execution":
        "SATISFIED: The task has been fully addressed.",
    });

    const program = executePlanExecute({
      taskDescription: "Simple task",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
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
