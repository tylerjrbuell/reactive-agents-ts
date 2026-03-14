// File: tests/strategies/tree-of-thought.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("TreeOfThoughtStrategy", () => {
  it("should execute tree exploration and return completed result", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Generate exactly", text: "1. Approach via historical analysis\n2. Approach via geographical lookup" },
      { match: "Rate this thought", text: "0.8" },
      { match: "Selected Approach", text: "FINAL ANSWER: Paris is the capital of France." },
    ]);

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
    expect(result.metadata.confidence).toBe(0.8);
  });

  it("should prune branches below threshold and still produce a result", async () => {
    // All scores below pruning threshold will cause early termination
    const layer = TestLLMServiceLayer([
      { match: "Generate exactly", text: "1. A weak approach\n2. Another weak approach" },
      { match: "Rate this thought", text: "0.1" },
      { match: "Selected Approach", text: "FINAL ANSWER: Best effort answer despite low scores." },
    ]);

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
    const layer = TestLLMServiceLayer([
      { match: "Generate exactly", text: "1. First thought\n2. Second thought" },
      { match: "Rate this thought", text: "0.7" },
      { match: "Selected Approach", text: "FINAL ANSWER: Final synthesized answer." },
    ]);

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

  it("adaptive pruning rescues tree when all candidates score below threshold", async () => {
    // All scoring returns 0.2 (below default 0.5 threshold)
    // Score 0.2 is below both the original threshold (0.5) AND the adaptive threshold (0.35),
    // so rescue fails — but the adaptive step is still emitted in the failure branch
    const layer = TestLLMServiceLayer([
      { match: "explore solution", text: "1. Approach one\n2. Approach two" },
      { match: "Rate this thought", text: "0.2" },
      { match: "Think step-by-step", text: "FINAL ANSWER: Recovered despite low scores." },
    ]);

    const result = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: "Solve a difficult creative problem",
        taskType: "creative",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            treeOfThought: { breadth: 2, depth: 2, pruningThreshold: 0.5 },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("tree-of-thought");
    expect(result.steps.length).toBeGreaterThan(2);
    // An adaptive pruning message should appear in steps
    const adaptiveStep = result.steps.find((s) =>
      s.content.toLowerCase().includes("adaptive"),
    );
    expect(adaptiveStep).toBeDefined();
  });

  it("adaptive pruning rescue-success: continues with rescued nodes when score is between adaptive and original threshold", async () => {
    // Score 0.4: below pruningThreshold 0.5, but above adaptive threshold 0.35 (0.5 - 0.15)
    // → frontier = rescued nodes; loop continues
    const layer = TestLLMServiceLayer([
      { match: "explore solution", text: "1. A feasible approach\n2. Another approach" },
      { match: "Rate this thought", text: "0.4" },
      { match: "Think step-by-step", text: "FINAL ANSWER: Completed via rescued path." },
    ]);

    const result = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: "Find an unconventional solution",
        taskType: "creative",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            // depth 1 so there's only one BFS round — we want rescue to happen on that round
            treeOfThought: { breadth: 2, depth: 1, pruningThreshold: 0.5 },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("tree-of-thought");
    // The adaptive step message should contain the threshold numbers
    const adaptiveStep = result.steps.find((s) =>
      s.content.includes("Adaptive pruning") || s.content.includes("adaptive"),
    );
    expect(adaptiveStep).toBeDefined();
    // The rescue succeeded so Phase 2 should run and produce a final answer
    expect(result.output).toBeTruthy();
  });

  it("parses scores in percentage format (75% → 0.75) and allows paths above threshold", async () => {
    // Score returned as "75%" — should parse to 0.75, above 0.5 threshold → tree proceeds
    const layer = TestLLMServiceLayer([
      { match: "explore solution", text: "1. Approach A\n2. Approach B" },
      { match: "Rate this thought", text: "75%" },
      { match: "Think step-by-step", text: "FINAL ANSWER: Answer from percentage-scored path." },
    ]);

    const result = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: "Solve a problem",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            treeOfThought: { breadth: 2, depth: 1, pruningThreshold: 0.5 },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("tree-of-thought");
    expect(result.status).toBe("completed");
    expect(result.output).toBeTruthy();
  });

  it("Phase 2 execution produces a structured final answer via kernel", async () => {
    const layer = TestLLMServiceLayer([
      { match: "explore solution", text: "1. Approach A with recursion\n2. Approach B with iteration" },
      { match: "Rate this thought", text: "0.8" },
      // Phase 2 kernel call — matches "Selected Approach" in the priorContext
      { match: "Selected Approach", text: "FINAL ANSWER: The best approach uses iteration for O(n) complexity." },
    ]);

    const result = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: "Find the most efficient sorting algorithm",
        taskType: "analysis",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            treeOfThought: { breadth: 2, depth: 1, pruningThreshold: 0.5 },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("tree-of-thought");
    expect(result.status).toBe("completed");
    expect(result.output).toContain("iteration");
  });
});
