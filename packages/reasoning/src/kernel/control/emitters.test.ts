// Run: bun test packages/reasoning/src/kernel/control/emitters.test.ts --timeout 15000
//
// F1 — control-plane emitters. Pins:
//   - long-gathering false-positive: evidenceDelta > 0 ⇒ NO stuck proposal wins
//   - the F3 remedy-metadata fix (tool-failure remedy, not a stall remedy)
//   - budget / veto / abstain / dispatcher / grounded-terminal mappings

import { describe, it, expect } from "bun:test";
import type { RunAssessment } from "../assessment/assess.js";
import {
  proposeFromBudgetMonitor,
  proposeFromControllerVeto,
  proposeFromDispatcher,
  proposeFromErrorRecovery,
  proposeFromForcedAbstention,
  proposeFromGroundedTerminal,
  proposeFromLoopDetector,
  proposeFromStallGuard,
} from "./emitters.js";
import { resolveControlPlane, type ControlProposal } from "./control-plane.js";

function mkAssessment(over: Partial<RunAssessment> = {}): RunAssessment {
  return {
    requirements: { satisfied: [], outstanding: [], blocked: [] },
    deliverables: { produced: [], missing: [] },
    evidenceDelta: 0,
    phase: "gather",
    pace: { burnRatio: 0.1, projectedCompletion: 0.1, band: "green" },
    health: {
      recentFailures: 0,
      consecutiveFailures: 0,
      repeatWaste: 0,
      stuckSignals: 0,
      contradictions: 0,
      iterationsSinceEvidence: 0,
      failureArgVariety: 0,
    },
    ...over,
  };
}

describe("long-gathering false-positive (control-plane level)", () => {
  it("15 distinct gathers / 15 iterations → NO kill/switch proposal survives resolution", () => {
    // Each of the 15 iterations produced NEW substantive evidence (evidenceDelta > 0)
    // so the loop-detector + stall emitters must decline to propose under the
    // long-horizon profile. Simulate the worst case: both a loop AND a stall are
    // structurally "triggered" this iteration, but the assessment says progress.
    for (let iter = 1; iter <= 15; iter++) {
      const assessment = mkAssessment({ evidenceDelta: 1, phase: "gather" });
      const loop = proposeFromLoopDetector({
        loopDetected: true,
        switchingViable: true,
        horizonActive: true,
        assessment,
      });
      const stall = proposeFromStallGuard({
        stallTriggered: true,
        missingRequiredTools: [],
        horizonActive: true,
        assessment,
      });
      expect(loop).toBeNull();
      expect(stall).toBeNull();

      const proposals = [loop, stall].filter((p): p is ControlProposal => p !== null);
      const resolution = resolveControlPlane(proposals);
      expect(resolution.action).toBe("continue"); // no stuck proposal wins
    }
  });

  it("OFF the profile the loop detector still proposes a switch (byte-identical legacy)", () => {
    const loop = proposeFromLoopDetector({
      loopDetected: true,
      switchingViable: true,
      horizonActive: false,
      assessment: mkAssessment({ evidenceDelta: 1 }),
    });
    expect(loop?.action).toBe("strategy-switch");
  });

  it("with NO evidence this iteration the loop detector proposes even under the profile", () => {
    const loop = proposeFromLoopDetector({
      loopDetected: true,
      switchingViable: false,
      horizonActive: true,
      assessment: mkAssessment({ evidenceDelta: 0 }),
    });
    expect(loop?.action).toBe("terminate");
  });
});

describe("F3 remedy-metadata fix (tool-failure remedy, not a stall remedy)", () => {
  it("BEFORE→AFTER: a repeated tool failure carries a tool-failure remedy naming the failing tool", () => {
    const p = proposeFromErrorRecovery({
      repeatedFailureTool: "web-search",
      errorClass: "timeout",
      failedTools: ["web-search"],
      guidance: "the web-search call keeps timing out",
      horizonActive: false,
      assessment: mkAssessment(),
    });
    expect(p).not.toBeNull();
    expect(p?.action).toBe("redirect");
    // AFTER (the fix): the remedy is a tool-failure that NAMES the tool — not the
    // pre-F1 generic "stall" remedy that told the model it was stuck.
    expect(p?.remedy?.kind).toBe("tool-failure");
    expect(p?.remedy?.kind).not.toBe("coverage");
    expect(p?.remedy?.tools).toContain("web-search");
    expect(p?.remedy?.detail).toContain("web-search");
  });

  it("arg-variety suppression (audit 02-#11): varying args under the profile ⇒ no proposal", () => {
    const p = proposeFromErrorRecovery({
      repeatedFailureTool: "web-search",
      failedTools: ["web-search"],
      guidance: "…",
      horizonActive: true,
      assessment: mkAssessment({ health: { ...mkAssessment().health, failureArgVariety: 3 } }),
    });
    expect(p).toBeNull();
  });
});

describe("terminal / veto / abstain / dispatcher mappings", () => {
  it("budget exceeded → terminate; ok/warning → null", () => {
    expect(
      proposeFromBudgetMonitor({ tokensUsed: 10, costUsd: 0, status: "exceeded", reason: "over" })?.action,
    ).toBe("terminate");
    expect(proposeFromBudgetMonitor({ tokensUsed: 1, costUsd: 0, status: "warning" })).toBeNull();
    expect(proposeFromBudgetMonitor(undefined)).toBeNull();
  });

  it("controller veto → veto (only when veto=true)", () => {
    expect(proposeFromControllerVeto({ veto: true, reason: "r" })?.action).toBe("veto");
    expect(proposeFromControllerVeto({ veto: false })).toBeNull();
  });

  it("forced abstention → abstain, naming the missing required tool", () => {
    const p = proposeFromForcedAbstention({ force: true, reason: "no ground", missing: ["tool:fetch"] });
    expect(p?.action).toBe("abstain");
    expect(p?.remedy?.tools).toContain("fetch");
    expect(proposeFromForcedAbstention(null)).toBeNull();
  });

  it("RI dispatcher: early-stop → terminate, switch-strategy → strategy-switch, compress → null", () => {
    expect(proposeFromDispatcher({ decision: "early-stop", reason: "converged" })?.action).toBe("terminate");
    expect(proposeFromDispatcher({ decision: "switch-strategy", reason: "stuck" })?.action).toBe("strategy-switch");
    expect(proposeFromDispatcher({ decision: "compress", reason: "big" })).toBeNull();
    expect(proposeFromDispatcher(null)).toBeNull();
  });

  it("grounded-terminal: redirect before the budget is spent, abstain after", () => {
    expect(
      proposeFromGroundedTerminal({ ungroundedTerminal: true, redirectSpent: false, guidance: "ground it", requiredTools: ["fetch"] })?.action,
    ).toBe("redirect");
    expect(
      proposeFromGroundedTerminal({ ungroundedTerminal: true, redirectSpent: true, guidance: "", requiredTools: ["fetch"] })?.action,
    ).toBe("abstain");
    expect(
      proposeFromGroundedTerminal({ ungroundedTerminal: false, redirectSpent: false, guidance: "", requiredTools: [] }),
    ).toBeNull();
  });
});
