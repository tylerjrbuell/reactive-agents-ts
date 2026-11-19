import { describe, expect, it } from "bun:test";
import { runCostPatch } from "./run-cost-patch.js";

describe("runCostPatch", () => {
  it("adds a priced call, marks an unpriced one partial, ignores other events", () => {
    expect(runCostPatch({ cost: 0.1 }, "LLMRequestCompleted", { estimatedCost: 0.2 })?.cost).toBeCloseTo(0.3, 10);
    expect(runCostPatch({ cost: 0.1 }, "LLMRequestCompleted", { priceSource: "unknown" })).toEqual({ cost: 0.1, costComplete: false });
    expect(runCostPatch({ cost: 0.1 }, "ToolCallCompleted", { estimatedCost: 9 })).toBeUndefined();
  });

  it("AgentCompleted keeps the provisional sum; RunCostFinalized sets the run total and completeness", () => {
    expect(runCostPatch({ cost: 0.1 }, "AgentCompleted", { totalCostUsd: 0.5 })).toEqual({ cost: 0.1, costComplete: undefined });
    expect(runCostPatch({ cost: 0.1 }, "AgentCompleted", { costComplete: false })).toEqual({ cost: 0.1, costComplete: false });
    expect(runCostPatch({ cost: 0.1, costComplete: false }, "RunCostFinalized", { totalCostUsd: 0.6, costComplete: true })).toEqual({ cost: 0.6, costComplete: undefined });
    expect(runCostPatch({ cost: 0.1 }, "RunCostFinalized", { totalCostUsd: 0.6, costComplete: false })).toEqual({ cost: 0.6, costComplete: false });
  });
});
