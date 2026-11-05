// termination-signals.test.ts — #281 direct-import seam pins for the
// decide/termination-signals evaluator zoo (extracted verbatim from
// arbitrator.ts, #220). These evaluators PROPOSE; the Arbitrator DECIDES, so
// each pin asserts the proposal a given context yields. Veto-at-finish-line is
// pinned separately in veto-finish-line.test.ts.

import { describe, expect, it } from "bun:test";
import {
  controllerSignalVetoEvaluator,
  defaultEvaluators,
  entropyConvergenceEvaluator,
  finalAnswerToolEvaluator,
  pendingToolCallEvaluator,
  reactiveControllerEarlyStopEvaluator,
} from "./termination-signals.js";
import type { TerminationContext } from "./termination-types.js";

function ctx(over: Partial<TerminationContext> = {}): TerminationContext {
  return {
    thought: "the answer is 42",
    stopReason: "end_turn",
    toolRequest: null,
    iteration: 3,
    steps: [],
    toolsUsed: new Set<string>(),
    requiredTools: [],
    allToolSchemas: [],
    redirectCount: 0,
    priorFinalAnswerAttempts: 0,
    taskDescription: "task",
    ...over,
  };
}

const converging = (derivative: number) => ({
  composite: 0.2,
  trajectory: { shape: "converging" as const, derivative, momentum: 0 },
});

describe("pendingToolCallEvaluator", () => {
  it("continues with high confidence when a tool call is pending", () => {
    const v = pendingToolCallEvaluator.evaluate(ctx({ toolRequest: { tool: "web-search", input: "{}" } }));
    expect(v).toEqual({ action: "continue", confidence: "high", reason: "tool_call_pending" });
  });

  it("has no opinion without a pending tool call", () => {
    expect(pendingToolCallEvaluator.evaluate(ctx())).toBeNull();
  });
});

describe("finalAnswerToolEvaluator", () => {
  it("is a placeholder: never proposes (handleActing owns the accept/reject)", () => {
    expect(finalAnswerToolEvaluator.evaluate(ctx())).toBeNull();
  });
});

describe("entropyConvergenceEvaluator — tier-aware derivative threshold", () => {
  const withEntropy = (tier: TerminationContext["tier"], derivative: number) =>
    ctx({ tier, entropy: converging(derivative), trajectory: converging(derivative).trajectory });

  it("exits with the trimmed thought once converging past the tier threshold", () => {
    const v = entropyConvergenceEvaluator.evaluate({ ...withEntropy("mid", -0.06), thought: "  done  " });
    expect(v).toEqual({ action: "exit", confidence: "high", reason: "entropy_converged", output: "done" });
  });

  it("the same derivative is enough for local (-0.03) but not frontier (-0.15)", () => {
    expect(entropyConvergenceEvaluator.evaluate(withEntropy("local", -0.06))?.action).toBe("exit");
    expect(entropyConvergenceEvaluator.evaluate(withEntropy("frontier", -0.06))).toBeNull();
  });

  it("defaults to the mid threshold (-0.05) when the tier is unknown", () => {
    expect(entropyConvergenceEvaluator.evaluate(withEntropy(undefined, -0.04))).toBeNull();
    expect(entropyConvergenceEvaluator.evaluate(withEntropy(undefined, -0.06))?.action).toBe("exit");
  });

  it("stands down unless the model ended its turn, or the thought is empty, or the shape is not converging", () => {
    expect(entropyConvergenceEvaluator.evaluate({ ...withEntropy("mid", -0.2), stopReason: "tool_use" })).toBeNull();
    expect(entropyConvergenceEvaluator.evaluate({ ...withEntropy("mid", -0.2), thought: "   " })).toBeNull();
    const flat = { composite: 0.2, trajectory: { shape: "flat" as const, derivative: -0.2, momentum: 0 } };
    expect(entropyConvergenceEvaluator.evaluate(ctx({ entropy: flat, trajectory: flat.trajectory }))).toBeNull();
  });

  it("has no opinion without entropy and trajectory", () => {
    expect(entropyConvergenceEvaluator.evaluate(ctx())).toBeNull();
  });
});

describe("reactiveControllerEarlyStopEvaluator", () => {
  it("exits with the controller's reason when an early-stop decision is present (no scratchpad to expand)", () => {
    const v = reactiveControllerEarlyStopEvaluator.evaluate(
      ctx({ thought: " wrap up ", controllerDecisions: [{ decision: "early-stop", reason: "flat trajectory" }] }),
    );
    expect(v).toEqual({
      action: "exit",
      confidence: "high",
      reason: "controller_early_stop: flat trajectory",
      output: "wrap up",
    });
  });

  it("ignores non-early-stop decisions and absent decisions", () => {
    expect(
      reactiveControllerEarlyStopEvaluator.evaluate(
        ctx({ controllerDecisions: [{ decision: "compress", reason: "ctx full" }] }),
      ),
    ).toBeNull();
    expect(reactiveControllerEarlyStopEvaluator.evaluate(ctx())).toBeNull();
  });
});

describe("controllerSignalVetoEvaluator — thresholds beyond the finish-line pin", () => {
  const log = (...entries: string[]) => ctx({ controllerDecisionLog: entries });

  it("fails on 3 tool-inject with no escalation", () => {
    const v = controllerSignalVetoEvaluator.evaluate(log("tool-inject: a", "tool-inject: b", "tool-inject: c"));
    expect(v?.action).toBe("fail");
    expect(v?.reason).toContain("3 tool-inject");
  });

  it("fails on a single stall once entropy is high (> 0.55)", () => {
    const high = ctx({ controllerDecisionLog: ["stall-detect: a"], entropy: { composite: 0.7 } });
    expect(controllerSignalVetoEvaluator.evaluate(high)?.reason).toContain("stall+entropy=0.70");
    const low = ctx({ controllerDecisionLog: ["stall-detect: a"], entropy: { composite: 0.4 } });
    expect(controllerSignalVetoEvaluator.evaluate(low)).toBeNull();
  });

  it("trusts a switch-strategy escalation: no veto", () => {
    expect(
      controllerSignalVetoEvaluator.evaluate(log("stall-detect: a", "stall-detect: b", "switch-strategy: x")),
    ).toBeNull();
  });

  it("only vetoes a run that is trying to exit", () => {
    const midLoop = ctx({
      stopReason: "tool_use",
      thought: "   ",
      controllerDecisionLog: ["stall-detect: a", "stall-detect: b"],
    });
    expect(controllerSignalVetoEvaluator.evaluate(midLoop)).toBeNull();
  });

  it("an empty log has no opinion", () => {
    expect(controllerSignalVetoEvaluator.evaluate(ctx())).toBeNull();
  });
});

describe("defaultEvaluators — chain order is load-bearing", () => {
  it("runs the pending-tool continue first and the veto before any exit proposal", () => {
    const names = defaultEvaluators.map((e) => e.name);
    expect(names[0]).toBe("PendingToolCall");
    expect(names[1]).toBe("ControllerSignalVeto");
    expect(names.indexOf("ControllerSignalVeto")).toBeLessThan(names.indexOf("EntropyConvergence"));
    expect(names.indexOf("FinalAnswerRegex")).toBeLessThan(names.indexOf("LLMEndTurn"));
  });

  it("omits the two evaluators that unconditionally return null", () => {
    const names = defaultEvaluators.map((e) => e.name);
    expect(names).not.toContain("FinalAnswerTool");
    expect(names).not.toContain("CompletionGap");
  });
});
