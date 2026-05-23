import { describe, test, expect } from "bun:test";
import { buildStrategyResult } from "../../src/kernel/capabilities/sense/step-utils.js";

// HS-106 / M7 invariant — output-status coherence.
//
// Sweep-2026-05-23 finding: tree-of-thought and plan-execute reported
// `status:"partial"` while emitting `output:null`. Downstream the runtime's
// empty-output fallback (execution-engine.ts:1138) treated `status !== "failed"`
// as a signal to substitute the last tool observation, producing
// `ExecutionResult.success=true` next to a `failed to produce output` log line.
//
// Fix: any strategy result whose output is null/undefined/empty MUST be
// status:"failed". This is enforced at the central builder so all strategies
// inherit the invariant.

describe("buildStrategyResult — output/status coherence (HS-106)", () => {
  test("null output coerces partial → failed", () => {
    const result = buildStrategyResult({
      strategy: "tree-of-thought",
      steps: [],
      output: null,
      status: "partial",
      start: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    });
    expect(result.status).toBe("failed");
  });

  test("null output coerces completed → failed (defensive)", () => {
    const result = buildStrategyResult({
      strategy: "plan-execute-reflect",
      steps: [],
      output: null,
      status: "completed",
      start: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    });
    expect(result.status).toBe("failed");
  });

  test("empty-string output coerces partial → failed", () => {
    const result = buildStrategyResult({
      strategy: "tree-of-thought",
      steps: [],
      output: "",
      status: "partial",
      start: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    });
    expect(result.status).toBe("failed");
  });

  test("whitespace-only output coerces partial → failed", () => {
    const result = buildStrategyResult({
      strategy: "reflexion",
      steps: [],
      output: "   \n  \t  ",
      status: "partial",
      start: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    });
    expect(result.status).toBe("failed");
  });

  test("substantive output preserves completed", () => {
    const result = buildStrategyResult({
      strategy: "tree-of-thought",
      steps: [],
      output: "The answer is 42.",
      status: "completed",
      start: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    });
    expect(result.status).toBe("completed");
  });

  test("substantive output preserves partial (still has something)", () => {
    const result = buildStrategyResult({
      strategy: "reflexion",
      steps: [],
      output: "Partial answer.",
      status: "partial",
      start: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    });
    expect(result.status).toBe("partial");
  });

  test("failed status preserved regardless of output", () => {
    const result = buildStrategyResult({
      strategy: "tree-of-thought",
      steps: [],
      output: "some content",
      status: "failed",
      start: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    });
    expect(result.status).toBe("failed");
  });

  test("non-string non-null output (object) preserves status when truthy", () => {
    const result = buildStrategyResult({
      strategy: "tree-of-thought",
      steps: [],
      output: { answer: 42 },
      status: "completed",
      start: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    });
    expect(result.status).toBe("completed");
  });
});
