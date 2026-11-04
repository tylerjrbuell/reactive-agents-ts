import { describe, expect, it } from "bun:test";
import { updateVitals, type CortexLiveMsg, type RunVitals } from "./run-store.js";

const base: RunVitals = {
  entropy: 0,
  trajectory: "EXPLORING",
  tokensUsed: 0,
  cost: 0,
  durationMs: 0,
  loopIteration: 0,
  reasoningSteps: 0,
  maxIterations: 0,
};

const msg = (type: string, payload: Record<string, unknown>): CortexLiveMsg => ({ ts: 1, agentId: "a", runId: "r", type, payload });

describe("updateVitals", () => {
  // Repro (cogito:8b chat run): the run switched reactive -> plan-execute-reflect, the pill still read "reactive".
  it("keeps the starting strategy and records the switched-to strategy", () => {
    let v = updateVitals(base, msg("ReasoningIterationProgress", { iteration: 1, strategy: "reactive" }), 0);
    v = updateVitals(v, msg("StrategySwitched", { from: "reactive", to: "plan-execute-reflect", reason: "loop" }), 0);
    expect(v.strategy).toBe("reactive");
    expect(v.switchedStrategy).toBe("plan-execute-reflect");
  });

  it("takes the starting strategy from StrategySwitched.from when no progress event named one", () => {
    const v = updateVitals(base, msg("StrategySwitched", { from: "reactive", to: "plan-execute-reflect" }), 0);
    expect(v.strategy).toBe("reactive");
  });

  it("surfaces a tolerated success from AgentCompleted.outcome", () => {
    const v = updateVitals(
      base,
      msg("AgentCompleted", {
        success: true,
        outcome: { status: "partial", success: true, tolerated: true, toleratedBy: "partial-substantive-output", statusReason: "tolerated" },
      }),
      0,
    );
    expect(v.toleratedBy).toBe("partial-substantive-output");
    expect(v.statusReason).toBe("tolerated");
  });

  it("leaves tolerance unset for an ordinary completion", () => {
    const v = updateVitals(base, msg("AgentCompleted", { success: true, outcome: { status: "completed", success: true } }), 0);
    expect(v.toleratedBy).toBeUndefined();
  });
});
