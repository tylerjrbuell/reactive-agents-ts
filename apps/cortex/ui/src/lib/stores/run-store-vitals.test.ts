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
  // Repro (2026-11-11 QA): a run terminated during its first model call read "Duration 3s" after 2 minutes.
  it("ends the duration at the stop event when no AgentCompleted came", () => {
    const at = (type: string, ts: number): CortexLiveMsg => ({ ts, agentId: "a", runId: "r", type, payload: {} });
    const start = 1_000_000;
    expect(updateVitals({ ...base, durationMs: 3000 }, at("AgentTerminated", start + 129_000), start).durationMs).toBe(129_000);
    expect(updateVitals(base, at("AgentStopped", start + 5_000), start).durationMs).toBe(5_000);
    expect(updateVitals({ ...base, durationMs: 9_000 }, at("ExecutionCancelled", start + 5_000), start).durationMs).toBe(9_000);
    expect(updateVitals(base, at("AgentTerminated", 5), 0).durationMs).toBe(0);
  });

  it("records the resolved tool disclosure from AgentStarted.config (run-started.config.disclosure)", () => {
    const v = updateVitals(base, msg("AgentStarted", { provider: "test", model: "m", config: { disclosure: { mode: "index", source: "withTools" } } }), 0);
    expect(v.disclosure).toEqual({ mode: "index", source: "withTools" });
    expect(updateVitals(base, msg("AgentStarted", { provider: "test", model: "m" }), 0).disclosure).toBeUndefined();
  });

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

  // Repro (kernel fix 14b7c3dd5): the server stored a step event's strategy label while this
  // store kept the loop's; both now fold ui-core `foldRunStrategy` (config > loop > step).
  it("names the strategy by the shared rule: run config, then the kernel loop, never a step label over them", () => {
    const fold = (events: [string, Record<string, unknown>][]) => events.reduce((v, [t, p]) => updateVitals(v, msg(t, p), 0), base);
    expect(fold([["ReasoningStepCompleted", { strategy: "structured-output-native" }], ["ReasoningIterationProgress", { iteration: 1, strategy: "plan-execute-reflect" }]]).strategy).toBe(
      "plan-execute-reflect",
    );
    expect(fold([["AgentStarted", { config: { builder: { strategy: "reflexion" } } }], ["ReasoningIterationProgress", { iteration: 1, strategy: "reactive" }]]).strategy).toBe("reflexion");
    // A switch back to the starting strategy is no switch to show.
    const back = fold([["ReasoningIterationProgress", { iteration: 1, strategy: "reactive" }], ["StrategySwitched", { from: "reactive", to: "reflexion" }], ["StrategySwitched", { from: "reflexion", to: "reactive" }]]);
    expect(back.strategy).toBe("reactive");
    expect(back.switchedStrategy).toBeUndefined();
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

  it("accumulates the provider split and billed/reasoning halves across calls", () => {
    let v = updateVitals(base, msg("LLMRequestCompleted", {
      tokensUsed: 1500, tokensIn: 1000, tokensOut: 500,
      billedTokens: 700, reasoningTokens: 120, estimatedCost: 0.01, durationMs: 900,
    }), 0);
    v = updateVitals(v, msg("LLMRequestCompleted", {
      tokensUsed: 500, tokensIn: 300, tokensOut: 200,
      billedTokens: 300, reasoningTokens: 30, estimatedCost: 0.02, durationMs: 400,
    }), 1);
    expect(v.tokensUsed).toBe(2000);
    expect(v.tokensIn).toBe(1300);
    expect(v.tokensOut).toBe(700);
    expect(v.billedTokens).toBe(1000);
    expect(v.reasoningTokens).toBe(150);
  });

  // Repro (2026-11-16): a plan-seeded run passed its configured 10 iterations, the readout still divided by 10.
  it("uses the plan-raised iteration bound over the configured one progress events carry", () => {
    let v = updateVitals(base, msg("ReasoningIterationProgress", { iteration: 1, maxIterations: 10 }), 0);
    expect(v.maxIterations).toBe(10);
    v = updateVitals(v, msg("GuardFiredEmitted", { guard: "plan_budget_raised", outcome: "pass", metadata: { configured: 10, steps: 22, effective: 23, hardCap: 30 } }), 0);
    expect(v.maxIterations).toBe(23);
    v = updateVitals(v, msg("ReasoningIterationProgress", { iteration: 11, maxIterations: 10 }), 0);
    expect(v.maxIterations).toBe(23);
    expect(updateVitals(v, msg("GuardFiredEmitted", { guard: "exit_gate", metadata: { effective: 99 } }), 0).maxIterations).toBe(23);
  });

  it("an unpriced call adds no dollars and marks the cost partial; RunCostFinalized sets the run total", () => {
    let v = updateVitals(base, msg("LLMRequestCompleted", { tokensUsed: 10, estimatedCost: 0.25, priceSource: "price-book" }), 0);
    expect(v.cost).toBe(0.25);
    expect(v.costComplete).toBeUndefined();
    v = updateVitals(v, msg("LLMRequestCompleted", { tokensUsed: 10, priceSource: "unknown" }), 0);
    expect(v.cost).toBe(0.25);
    expect(v.costComplete).toBe(false);
    // AgentCompleted.totalCostUsd excludes the debrief call: the provisional sum stays.
    v = updateVitals(v, msg("AgentCompleted", { totalCostUsd: 0.4 }), 0);
    expect(v.cost).toBe(0.25);
    expect(v.costComplete).toBe(false);
    const partial = updateVitals(v, msg("RunCostFinalized", { totalCostUsd: 0.45, costComplete: false }), 0);
    expect(partial.cost).toBe(0.45);
    expect(partial.costComplete).toBe(false);
    const full = updateVitals(v, msg("RunCostFinalized", { totalCostUsd: 0.45, costComplete: true }), 0);
    expect(full.cost).toBe(0.45);
    expect(full.costComplete).toBeUndefined();
  });

  it("keeps unreported halves absent rather than fabricating them", () => {
    const v = updateVitals(base, msg("LLMRequestCompleted", { tokensUsed: 1500, estimatedCost: 0.01 }), 0);
    expect(v.tokensIn).toBeUndefined();
    expect(v.tokensOut).toBeUndefined();
    expect(v.billedTokens).toBeUndefined();
    expect(v.reasoningTokens).toBeUndefined();
  });
});
