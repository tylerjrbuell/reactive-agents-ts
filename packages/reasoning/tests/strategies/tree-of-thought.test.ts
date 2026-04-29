// File: tests/strategies/tree-of-thought.test.ts
import { describe, it, expect } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EntropySensorService } from "@reactive-agents/core";

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

  // ── T4 (W5 FIX-5 regression) ────────────────────────────────────────────
  // Verifies that a parent-issued early-stop dispatched at depth 1 terminates
  // the BFS outer loop before reaching configured depth (3 here). Mirrors the
  // wiring in tree-of-thought.ts:342-431 added in commit 89bbe321.
  it("dispatcher early-stop terminates BFS outer loop at depth 1 (T4 / FIX-5)", async () => {
    const llmLayer = TestLLMServiceLayer([
      { match: "Generate exactly", text: "1. Approach A\n2. Approach B" },
      { match: "Rate this thought", text: "0.9" },
      { match: "Selected Approach", text: "FINAL ANSWER: stopped early." },
    ]);

    // Stub EntropySensorService — returns a single high-entropy score so the
    // controller has a non-empty entropyHistory to act on. Phase 2 synthesis
    // spawns a sub-kernel that also touches getCalibration / updateCalibration
    // / getTrajectory / scoreContext, so those are stubbed too.
    const calibrationStub = {
      modelId: "test",
      calibrated: false,
      sampleCount: 0,
      highEntropyThreshold: 0.8,
      convergenceThreshold: 0.4,
    };
    const entropySensorLayer = Layer.succeed(EntropySensorService, {
      score: () =>
        Effect.succeed({
          composite: 0.9,
          sources: { token: 0, structural: 0.9, semantic: 0, behavioral: 0, contextPressure: 0 },
          trajectory: { derivative: 0, shape: "stable", momentum: 0 },
          confidence: "high" as const,
          modelTier: "unknown" as const,
          iteration: 0,
          iterationWeight: 1,
          timestamp: Date.now(),
        }),
      scoreContext: () =>
        Effect.succeed({
          utilizationPct: 0,
          sections: [],
          atRiskSections: [],
          compressionHeadroom: 1,
        }),
      getCalibration: () => Effect.succeed(calibrationStub),
      updateCalibration: () => Effect.succeed(calibrationStub),
      getTrajectory: () =>
        Effect.succeed({ history: [], derivative: 0, momentum: 0, shape: "stable" }),
    } as any);

    // Stub ReactiveControllerService via GenericTag matching the name in
    // service-utils.ts:76. Returns a single early-stop decision.
    const ReactiveControllerTag = Context.GenericTag<{
      readonly evaluate: (...args: any[]) => Effect.Effect<readonly { decision: string; reason: string }[]>;
    }>("ReactiveControllerService");
    const controllerLayer = Layer.succeed(ReactiveControllerTag, {
      evaluate: () =>
        Effect.succeed([{ decision: "early-stop", reason: "T4 stub forces early-stop" }]),
    });

    // Stub InterventionDispatcherService via GenericTag matching the name in
    // service-utils.ts:109. Returns appliedPatches with kind: "early-stop"
    // — this is the signal tree-of-thought.ts:422 sets perStrategyEarlyStop on.
    let dispatchCallCount = 0;
    const InterventionDispatcherTag = Context.GenericTag<{
      readonly dispatch: (...args: any[]) => Effect.Effect<{
        readonly appliedPatches: readonly { readonly kind: string }[];
        readonly skipped: readonly { decisionType: string; reason: string }[];
        readonly totalCost: { tokens: number; latencyMs: number };
      }>;
    }>("InterventionDispatcherService");
    const dispatcherLayer = Layer.succeed(InterventionDispatcherTag, {
      dispatch: () => {
        dispatchCallCount += 1;
        return Effect.succeed({
          appliedPatches: [{ kind: "early-stop" }],
          skipped: [],
          totalCost: { tokens: 50, latencyMs: 10 },
        });
      },
    });

    const fullLayer = Layer.mergeAll(llmLayer, entropySensorLayer, controllerLayer, dispatcherLayer);

    const program = executeTreeOfThought({
      taskDescription: "Test BFS early-stop",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          // depth: 3 so we can verify break before exhausting all depths
          treeOfThought: { breadth: 2, depth: 3, pruningThreshold: 0.3 },
        },
      },
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));

    // 1. Dispatcher fired at least once (BFS loop dispatch at depth 1).
    //    Phase 2 synthesis sub-kernel may also call dispatch independently,
    //    so the assertion is >= 1 here.
    expect(dispatchCallCount).toBeGreaterThanOrEqual(1);

    // 2. Early-stop step record present (proves the BFS break ran)
    const earlyStopStep = result.steps.find((s) =>
      s.content.includes("Dispatcher early-stop signal received at depth 1"),
    );
    expect(earlyStopStep).toBeDefined();

    // 3. BFS terminated at depth 1: scoring-step markers `[TOT d=N]` only
    //    appear for d=1 — depths 2 and 3 are never explored.
    const totDepthMarkers = result.steps.filter((s) =>
      /\[TOT d=(\d+)\]/.test(s.content),
    );
    const maxDepthSeen = totDepthMarkers
      .map((s) => Number(s.content.match(/\[TOT d=(\d+)\]/)?.[1] ?? 0))
      .reduce((a, b) => Math.max(a, b), 0);
    expect(maxDepthSeen).toBe(1);

    // 4. Strategy still completes (Phase 2 synthesis runs on best-so-far)
    expect(result.strategy).toBe("tree-of-thought");
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
