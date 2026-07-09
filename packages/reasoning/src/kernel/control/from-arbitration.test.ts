// Run: bun test packages/reasoning/src/kernel/control/from-arbitration.test.ts --timeout 15000
//
// F1 — the DECISION-ORDER CORPUS. Pins the pre-F1 arbitrator decision across the
// representative TerminationIntent × context scenarios, then proves the F1 control
// resolver reproduces the SAME action for every one of them (the ONLY deliberate
// divergence — the P5 fix — is tested in control-plane.test.ts). This is the
// "pin-then-consolidate" acceptance: if arbitrate() ever changes precedence
// unexpectedly, the pinned action breaks here; and if the resolver's total order
// drifts from the arbitrator, the reproduction assertion breaks.

import { describe, it, expect } from "bun:test";
import {
  arbitrate,
  type ArbitrationContext,
  type BudgetSignal,
  type TerminationIntent,
  type Verdict,
} from "../capabilities/decide/arbitrator.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { makeObservationResult } from "../utils/observation-helpers.js";
import type { ReasoningStep } from "../../types/index.js";
import { resolveControlPlane, type ControlAction } from "./control-plane.js";
import { controlActionForVerdict, proposalsForVerdict } from "./from-arbitration.js";

function makeCtx(overrides: Partial<ArbitrationContext> = {}): ArbitrationContext {
  return {
    iteration: 2,
    task: "test task",
    steps: [],
    toolsUsed: new Set<string>(),
    requiredTools: [],
    ...overrides,
  };
}

const failedObs = (toolName: string, error: string): ReasoningStep =>
  makeStep("observation", error, { observationResult: makeObservationResult(toolName, false, error) });

const exceededBudget: BudgetSignal = {
  tokensUsed: 5000,
  costUsd: 0.5,
  tokenLimit: 1000,
  status: "exceeded",
  reason: "tokens 5000 ≥ tokenLimit 1000",
};

// The pinned corpus: (name, intent, ctx, expected control action). The expected
// action is the pre-F1 arbitrator decision translated into the control vocabulary.
interface Case {
  readonly name: string;
  readonly intent: TerminationIntent;
  readonly ctx: ArbitrationContext;
  readonly expected: ControlAction;
}

const CORPUS: readonly Case[] = [
  {
    name: "max-iterations → terminate (exit-failure)",
    intent: { kind: "max-iterations", output: "" },
    ctx: makeCtx({ maxIterations: 5 }),
    expected: "terminate",
  },
  {
    name: "kernel-error → terminate (exit-failure)",
    intent: { kind: "kernel-error", error: "boom" },
    ctx: makeCtx(),
    expected: "terminate",
  },
  {
    name: "budget-exceeded pre-guard → terminate (dominates the intent)",
    intent: { kind: "agent-final-answer", via: "tool", output: "answer" },
    ctx: makeCtx({ budget: exceededBudget }),
    expected: "terminate",
  },
  {
    name: "controller-early-stop (healthy) → terminate (exit-success)",
    intent: { kind: "controller-early-stop", output: "done", reason: "converged" },
    ctx: makeCtx(),
    expected: "terminate",
  },
  {
    name: "loop-detected (healthy) → terminate (exit-success)",
    intent: { kind: "loop-detected", output: "partial", reason: "repeat" },
    ctx: makeCtx(),
    expected: "terminate",
  },
  {
    name: "fast-path-completed (healthy) → terminate (exit-success)",
    intent: { kind: "fast-path-completed", output: "trivial" },
    ctx: makeCtx(),
    expected: "terminate",
  },
  {
    name: "agent-final-answer via tool (healthy) → terminate (exit-success)",
    intent: { kind: "agent-final-answer", via: "tool", output: "the answer" },
    ctx: makeCtx(),
    expected: "terminate",
  },
  {
    name: "agent-final-answer via regex (healthy) → terminate (exit-success)",
    intent: { kind: "agent-final-answer", via: "regex", output: "the answer" },
    ctx: makeCtx(),
    expected: "terminate",
  },
  {
    name: "agent-final-answer with controller veto → veto (exit-failure)",
    intent: { kind: "agent-final-answer", via: "regex", output: "premature" },
    // Pathological controller log (≥2 stall-detect, no switch-strategy) + a failed
    // non-meta tool observation → shouldVetoSuccess fires (arbitrator veto family).
    ctx: makeCtx({
      controllerDecisionLog: ["stall-detect: r1", "stall-detect: r2"],
      steps: [failedObs("web-search", "connection refused")],
    }),
    expected: "veto",
  },
];

describe("decision-order corpus — resolver reproduces the pre-F1 arbitrator decision", () => {
  for (const c of CORPUS) {
    it(c.name, () => {
      const verdict: Verdict = arbitrate(c.intent, c.ctx);
      // (a) Pin the arbitrator's decision (translated to the control vocabulary).
      const mapped = controlActionForVerdict(verdict);
      expect(mapped).toBe(c.expected);
      // (b) The F1 resolver reproduces the SAME action from the equivalent proposals.
      const resolution = resolveControlPlane(proposalsForVerdict(verdict));
      const resolvedAction = resolution.winner === null ? "continue" : resolution.action;
      expect(resolvedAction).toBe(c.expected);
    });
  }

  it("a continue verdict maps to an empty proposal set → resolver returns continue", () => {
    const verdict: Verdict = { action: "continue" };
    expect(controlActionForVerdict(verdict)).toBe("continue");
    expect(proposalsForVerdict(verdict)).toHaveLength(0);
    expect(resolveControlPlane(proposalsForVerdict(verdict)).action).toBe("continue");
  });
});
