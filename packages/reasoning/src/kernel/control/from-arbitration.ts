// File: src/kernel/control/from-arbitration.ts
//
// The bridge that lets the F1 resolver REPRODUCE the pre-F1 arbitrator decision
// for the decision-order corpus (F1 acceptance): the arbitrator (the single
// terminal owner) already resolves a TerminationIntent into exactly ONE Verdict.
// F1 does not rip that resolver out — it generalizes it. This adapter maps a
// `Verdict` onto the equivalent `ControlProposal`, so a corpus test can pin
// `arbitrate(...)` across representative scenarios and assert that
// `resolveControlPlane(proposalsForVerdict(v)).action === controlActionForVerdict(v)`
// — proving the total order reproduces every pinned precedence relationship
// (the ONLY deliberate divergence is the P5 fix, which is tested separately).
//
// DAG-safe: pure mapping over plain data.

import { GROUNDING_REDIRECT } from "../loop/runner-helpers/grounded-terminal.js";
import type { Verdict } from "../capabilities/decide/arbitrator.js";
import type { ControlAction, ControlProposal } from "./control-plane.js";

/** The two escalate sentinels that are NOT strategy switches (see arbitrator.ts). */
const POST_CONDITION_STEER = "post-condition-steer";
const RETRY_WITH_FEEDBACK = "retry-with-feedback";

/** terminatedBy values the arbitrator uses for the controllerSignalVeto family. */
const VETO_TERMINATED_BY = new Set(["controller_signal_veto", "loop_detected_with_veto"]);

/** The control action that a resolved arbitrator Verdict corresponds to. */
export function controlActionForVerdict(verdict: Verdict): ControlAction {
  switch (verdict.action) {
    case "continue":
      return "continue";
    case "exit-success":
      return "terminate";
    case "exit-failure":
      return VETO_TERMINATED_BY.has(verdict.terminatedBy) ? "veto" : "terminate";
    case "escalate": {
      if (verdict.nextStrategy === GROUNDING_REDIRECT) return "redirect";
      if (verdict.nextStrategy === POST_CONDITION_STEER) return "steer";
      if (verdict.nextStrategy === RETRY_WITH_FEEDBACK) return "steer";
      return "strategy-switch";
    }
  }
}

/**
 * The proposal set equivalent to a resolved arbitrator Verdict. Each Verdict
 * corresponds to exactly ONE proposal (the arbitrator already picked one action);
 * the resolver over this singleton reproduces the arbitrator's choice.
 */
export function proposalsForVerdict(verdict: Verdict): readonly ControlProposal[] {
  const action = controlActionForVerdict(verdict);
  if (action === "continue") return [];
  const reason =
    verdict.action === "exit-failure"
      ? verdict.error
      : verdict.action === "escalate"
        ? verdict.reason
        : verdict.action === "exit-success"
          ? verdict.terminatedBy
          : "continue";
  return [{ source: "arbitrator", action, reason, confidence: "high" }];
}
