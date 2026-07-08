// veto-finish-line.test.ts — E2 named regression: veto-at-finish-line (audit 02-#2).
//
// The controller veto converts an apparent agent success into a failure when the
// controllerDecisionLog shows pathological tactical churn (≥2 stall-detect) and
// no switch-strategy escalation. On a LONG run that legitimately churned early
// but then reached the synthesis endgame, this misfires — it amputates a
// finishing run's success on stale churn. E2: under the long-horizon profile the
// veto stands down once assessment.phase === "synthesize".
//
// Also pins the plumbing seam: arbitrationContextFromState surfaces
// assessmentPhase ONLY under the profile (absent by default → byte-identical).

import { describe, expect, it } from "bun:test";
import {
  arbitrationContextFromState,
  controllerSignalVetoEvaluator,
  type TerminationContext,
} from "./arbitrator.js";
import {
  initialKernelState,
  transitionState,
  type KernelRunOptions,
} from "../../state/kernel-state.js";
import type { RunAssessment, RunPhase } from "../../assessment/assess.js";

// A ctx that WOULD veto: agent looking to exit, ≥2 stall-detect, no escalation.
function vetoingCtx(over: Partial<TerminationContext> = {}): TerminationContext {
  return {
    thought: "final answer ready",
    stopReason: "end_turn",
    toolRequest: null,
    iteration: 40,
    steps: [],
    toolsUsed: new Set<string>(),
    requiredTools: [],
    allToolSchemas: [],
    redirectCount: 0,
    priorFinalAnswerAttempts: 0,
    taskDescription: "long research task",
    controllerDecisionLog: ["stall-detect: a", "stall-detect: b", "tool-inject: c"],
    ...over,
  };
}

describe("controllerSignalVetoEvaluator — veto-at-finish-line", () => {
  it("OLD (no assessmentPhase) MISFIRES: vetoes the finishing run", () => {
    const verdict = controllerSignalVetoEvaluator.evaluate(vetoingCtx());
    expect(verdict).not.toBeNull();
    expect(verdict?.action).toBe("fail");
  });

  it("NEW: synthesize phase stands the veto down (no amputation)", () => {
    const verdict = controllerSignalVetoEvaluator.evaluate(
      vetoingCtx({ assessmentPhase: "synthesize" }),
    );
    expect(verdict).toBeNull();
  });

  it("NEW: a non-synthesize phase (still gathering) preserves the veto", () => {
    const phases: RunPhase[] = ["orient", "gather", "execute", "verify"];
    for (const phase of phases) {
      const verdict = controllerSignalVetoEvaluator.evaluate(vetoingCtx({ assessmentPhase: phase }));
      expect(verdict).not.toBeNull();
    }
  });
});

// ── Plumbing seam: assessmentPhase surfaced only under the profile ──────────

const baseOpts = (over: Partial<KernelRunOptions>): KernelRunOptions => ({
  maxIterations: 50,
  strategy: "reactive",
  kernelType: "react",
  ...over,
});

function synthAssessment(): RunAssessment {
  return {
    requirements: { satisfied: [], outstanding: [], blocked: [] },
    deliverables: { produced: [], missing: [] },
    evidenceDelta: 0,
    phase: "synthesize",
    pace: { burnRatio: 0, projectedCompletion: 0, band: "green" },
    health: {
      recentFailures: 0,
      consecutiveFailures: 0,
      repeatWaste: 0,
      stuckSignals: 0,
      contradictions: 0,
      iterationsSinceEvidence: 0,
      failureArgVariety: 0,
    },
  };
}

describe("arbitrationContextFromState — assessmentPhase plumbing", () => {
  it("OFF by default: no assessmentPhase even when an assessment is cached", () => {
    let s = initialKernelState(baseOpts({}));
    s = transitionState(s, { meta: { ...s.meta, assessment: synthAssessment() } });
    const ctx = arbitrationContextFromState(s, { task: "t", requiredTools: [] });
    expect(ctx.assessmentPhase).toBeUndefined();
  });

  it("ON: assessmentPhase mirrored from the cached assessment", () => {
    let s = initialKernelState(baseOpts({ horizonProfile: "long" }));
    s = transitionState(s, { meta: { ...s.meta, assessment: synthAssessment() } });
    const ctx = arbitrationContextFromState(s, { task: "t", requiredTools: [] });
    expect(ctx.assessmentPhase).toBe("synthesize");
  });

  it("ON but no assessment cached yet: assessmentPhase absent (defensive)", () => {
    const s = initialKernelState(baseOpts({ horizonProfile: "long" }));
    const ctx = arbitrationContextFromState(s, { task: "t", requiredTools: [] });
    expect(ctx.assessmentPhase).toBeUndefined();
  });
});
