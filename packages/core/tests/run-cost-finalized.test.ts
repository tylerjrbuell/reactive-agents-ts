import { describe, expect, it } from "bun:test";
import type { AgentEvent, DebriefCompleted } from "../src/index.js";

type DebriefPayload = DebriefCompleted["debrief"];

type RunCostFinalized = Extract<AgentEvent, { _tag: "RunCostFinalized" }>;
type AgentCompleted = Extract<AgentEvent, { _tag: "AgentCompleted" }>;
type SynthesisTokens = NonNullable<DebriefPayload["metrics"]["synthesisTokens"]>;

describe("final run cost contract", () => {
  it("RunCostFinalized carries the billed total and its completeness", () => {
    const event: RunCostFinalized = {
      _tag: "RunCostFinalized",
      taskId: "t1",
      agentId: "a1",
      totalCostUsd: 0.0042,
      costComplete: true,
    };
    const asAgentEvent: AgentEvent = event;
    expect(asAgentEvent._tag).toBe("RunCostFinalized");
    expect(event.runId).toBeUndefined();
  });

  it("RunCostFinalized requires both the total and the flag", () => {
    // @ts-expect-error — costComplete is required: consumers get one honest number
    const missingFlag: RunCostFinalized = { _tag: "RunCostFinalized", taskId: "t1", agentId: "a1", totalCostUsd: 0 };
    // @ts-expect-error — totalCostUsd is required (a lower bound, never absent)
    const missingTotal: RunCostFinalized = { _tag: "RunCostFinalized", taskId: "t1", agentId: "a1", costComplete: false };
    expect(missingFlag._tag).toBe(missingTotal._tag);
  });

  it("AgentCompleted.costComplete is optional (absent = complete or legacy)", () => {
    const base = {
      _tag: "AgentCompleted",
      taskId: "t1",
      agentId: "a1",
      success: true,
      totalIterations: 1,
      totalTokens: 10,
      durationMs: 5,
    } as const;
    const legacy: AgentCompleted = { ...base, totalCostUsd: 0.001 };
    const partial: AgentCompleted = { ...base, totalCostUsd: 0.001, costComplete: false };
    expect(legacy.costComplete).toBeUndefined();
    expect(partial.costComplete).toBe(false);
  });

  it("synthesisTokens marks an unpriced debrief call with costComplete: false", () => {
    const priced: SynthesisTokens = { total: 100, cost: 0.0003, calls: 1 };
    const unpriced: SynthesisTokens = { total: 100, cost: 0, costComplete: false, calls: 1 };
    expect(priced.costComplete).toBeUndefined();
    expect(unpriced.costComplete).toBe(false);
  });
});
