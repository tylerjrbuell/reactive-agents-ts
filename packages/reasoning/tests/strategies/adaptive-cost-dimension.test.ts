// File: tests/strategies/adaptive-cost-dimension.test.ts
//
// HS-111 / M5 — Adaptive routing cost dimension (sweep-2026-05-23).
//
// Verifies:
//  1. classifyTaskComplexity is consulted in heuristicClassify — trivial tasks
//     route to reactive regardless of pattern matches.
//  2. costAwareAdjustment() downgrades expensive picks when history shows a
//     cheaper alternative with comparable success rate.
//  3. Integration: adaptive emits cost-downgrade trace step + extraMetadata.

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { costAwareAdjustment } from "../../src/strategies/adaptive.js";
import type { StrategyOutcome } from "../../src/strategies/adaptive.js";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

const cheapHistory: StrategyOutcome[] = [
  { strategy: "reactive", success: true, durationMs: 1000, tokensUsed: 500, taskDescription: "x" },
  { strategy: "reactive", success: true, durationMs: 1100, tokensUsed: 600, taskDescription: "y" },
  { strategy: "reactive", success: true, durationMs: 900, tokensUsed: 550, taskDescription: "z" },
];

const expensiveTotHistory: StrategyOutcome[] = [
  { strategy: "tree-of-thought", success: true, durationMs: 5000, tokensUsed: 3500, taskDescription: "x" },
  { strategy: "tree-of-thought", success: true, durationMs: 6000, tokensUsed: 4000, taskDescription: "y" },
  { strategy: "tree-of-thought", success: true, durationMs: 5500, tokensUsed: 3800, taskDescription: "z" },
];

describe("HS-111 — costAwareAdjustment", () => {
  it("downgrades tree-of-thought to reactive when ToT is 2× more expensive", () => {
    const adj = costAwareAdjustment("tree-of-thought", [...cheapHistory, ...expensiveTotHistory]);
    expect(adj.downgraded).toBe(true);
    expect(adj.strategy).toBe("reactive");
    expect(adj.reason).toContain("cost-downgrade");
  });

  it("does not downgrade when picked strategy has <3 history samples", () => {
    const adj = costAwareAdjustment("tree-of-thought", [
      ...cheapHistory,
      { strategy: "tree-of-thought", success: true, durationMs: 5000, tokensUsed: 3500, taskDescription: "x" },
    ]);
    expect(adj.downgraded).toBe(false);
    expect(adj.reason).toBe("insufficient-history");
  });

  it("does not downgrade when no cheaper alternative exists in history", () => {
    const onlyTot: StrategyOutcome[] = [
      { strategy: "tree-of-thought", success: true, durationMs: 5000, tokensUsed: 500, taskDescription: "x" },
      { strategy: "tree-of-thought", success: true, durationMs: 5500, tokensUsed: 600, taskDescription: "y" },
      { strategy: "tree-of-thought", success: true, durationMs: 5200, tokensUsed: 550, taskDescription: "z" },
    ];
    const adj = costAwareAdjustment("tree-of-thought", onlyTot);
    expect(adj.downgraded).toBe(false);
    expect(adj.reason).toBe("no-cheaper-alternative");
  });

  it("does not downgrade when cheaper alternative has much lower success rate", () => {
    const lowSuccessReactive: StrategyOutcome[] = [
      { strategy: "reactive", success: false, durationMs: 1000, tokensUsed: 500, taskDescription: "x" },
      { strategy: "reactive", success: false, durationMs: 1000, tokensUsed: 500, taskDescription: "y" },
      { strategy: "reactive", success: false, durationMs: 1000, tokensUsed: 500, taskDescription: "z" },
    ];
    const adj = costAwareAdjustment("tree-of-thought", [...lowSuccessReactive, ...expensiveTotHistory]);
    expect(adj.downgraded).toBe(false);
    // Reactive's 0% success vs ToT's 100% is well outside the 15pp tolerance.
  });

  it("does not downgrade reactive when reactive is already picked", () => {
    const adj = costAwareAdjustment("reactive", [...cheapHistory, ...expensiveTotHistory]);
    expect(adj.downgraded).toBe(false);
  });

  it("downgrades to the cheapest qualifying alternative when multiple exist", () => {
    const cheaperPlanExec: StrategyOutcome[] = [
      { strategy: "plan-execute-reflect", success: true, durationMs: 800, tokensUsed: 300, taskDescription: "x" },
      { strategy: "plan-execute-reflect", success: true, durationMs: 900, tokensUsed: 350, taskDescription: "y" },
      { strategy: "plan-execute-reflect", success: true, durationMs: 700, tokensUsed: 280, taskDescription: "z" },
    ];
    const adj = costAwareAdjustment("tree-of-thought", [
      ...cheapHistory,
      ...cheaperPlanExec,
      ...expensiveTotHistory,
    ]);
    expect(adj.downgraded).toBe(true);
    expect(adj.strategy).toBe("plan-execute-reflect"); // cheapest of {reactive, plan-execute}
  });
});

describe("HS-111 — adaptive heuristic uses complexity classifier", () => {
  it("routes 'what is the capital of France' to reactive (trivial)", async () => {
    const layer = TestLLMServiceLayer([
      { match: "capital of France", text: "Paris is the capital of France." },
    ]);
    const result = await Effect.runPromise(
      executeAdaptive({
        taskDescription: "What is the capital of France?",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(layer)),
    );
    const md = result.metadata as Record<string, unknown>;
    // The trivial-task complexity gate forces reactive.
    expect(md.selectedStrategy).toBe("reactive");
  });
});

describe("HS-111 — cost-aware downgrade integrates into adaptive flow", () => {
  it("emits cost-downgrade step + metadata when history justifies downgrade", async () => {
    // The task is "compare trade-offs..." which the complexity classifier
    // marks complex → heuristic returns "tree-of-thought". History shows ToT
    // is 2× reactive's cost with comparable success → downgrade fires.
    const layer = TestLLMServiceLayer([
      { match: "capital of France", text: "Paris." },
      { match: "Compare", text: "Reactive answer to comparison." },
      { match: "compare", text: "Reactive answer to comparison." },
    ]);

    const result = await Effect.runPromise(
      executeAdaptive({
        taskDescription:
          "Compare the trade-offs between hash indexes and B-trees in terms of insertion speed, lookup performance, and storage overhead across modern databases.",
        taskType: "analysis",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
        pastExperience: [...cheapHistory, ...expensiveTotHistory],
      }).pipe(Effect.provide(layer)),
    );

    const md = result.metadata as Record<string, unknown>;
    expect(md.costAwareDowngrade).toBeDefined();
    expect(String(md.costAwareDowngrade)).toContain("cost-downgrade");
    expect(md.selectedStrategy).not.toBe("tree-of-thought"); // got downgraded

    const downgradeStep = result.steps.find((s) =>
      s.content.includes("Cost-aware downgrade"),
    );
    expect(downgradeStep).toBeDefined();
  });
});
