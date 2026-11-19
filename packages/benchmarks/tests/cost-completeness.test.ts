import { describe, expect, it } from "bun:test";
import { buildSummary } from "../src/runner.js";
import type { TaskResult } from "../src/types.js";

// LLMRequestCompleted.estimatedCost is optional: absent = price unknown, NOT
// free. A bench total that includes an unknown-price task must say it is
// partial instead of reading as exact.
const task = (estimatedCost: number, costComplete: boolean): TaskResult => ({
  taskId: "t",
  tier: "trivial",
  strategy: "single-shot",
  status: "pass",
  durationMs: 1,
  tokensUsed: 10,
  estimatedCost,
  costComplete,
  iterations: 1,
  output: "",
});

describe("buildSummary cost completeness", () => {
  it("is complete only when every task's cost is complete", () => {
    const s = buildSummary([task(0.01, true), task(0.02, true)]);
    expect(s.totalCost).toBeCloseTo(0.03, 10);
    expect(s.costComplete).toBe(true);
  });

  it("one unknown-price task makes the total partial", () => {
    const s = buildSummary([task(0.01, true), task(0, false)]);
    expect(s.totalCost).toBeCloseTo(0.01, 10);
    expect(s.costComplete).toBe(false);
  });
});
