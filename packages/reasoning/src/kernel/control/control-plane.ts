// File: src/kernel/control/control-plane.ts
//
// Control Plane — the meta-loop's action-selection node (spec §"Control Plane":
// "proposals → ONE action"). The FOURTH node of the one-directional meta-loop DAG:
//
//   RunContract → RunLedger → RunAssessment → CONTROL → Actuators → Projector
//
// Before F1 every control emitter (loop detector, RI dispatcher, the guards, the
// budget monitor, F1 grounded-terminal, F3 error-recovery, forced abstention)
// DIRECTLY forced its own action at its own site in the loop body. Nothing
// reconciled them, so two could fire in one iteration — the P5 race (abstention
// vs strategy-switch both firing). This module gives them ONE shared vocabulary
// (`ControlProposal`) and ONE resolver (`resolveControlPlane`) with a DOCUMENTED
// TOTAL ORDER, so exactly ONE action wins per iteration.
//
// DAG law (spec §4 rule 1): proposals CONSUME the already-computed
// `state.meta.assessment` (E1) + the ledger — they never recompute assessment,
// never mutate the ledger, and the CHOSEN action re-enters the run only as a
// ledger entry / the existing terminal/redirect paths (harness-signal). No
// component here reads a downstream node; there are no back-edges.
//
// This module is PURE (no Effect, no state mutation). The wiring sites build the
// proposals, call `resolveControlPlane`, emit the `control-resolution` trace, and
// apply the winner through the existing actuators.

import type { RunAssessment } from "../assessment/assess.js";

// ─── Action vocabulary ───────────────────────────────────────────────────────
//
// The closed set of control actions — one per thing a control component can ask
// the harness to do. Matches what the arbitrator already decides among (exit /
// escalate / veto / continue) plus the two the loop body forces directly today
// (redirect steering, strategy switch) and the honest forced decline (abstain).

/**
 * A control action. The resolver picks exactly ONE of these per iteration.
 *
 *   - `veto`           — a run proven failing must not be reported as success
 *                        (arbitrator controllerSignalVeto → exit-failure).
 *   - `abstain`        — honest forced decline when grounding is impossible
 *                        (runner §7.5 forced abstention → terminatedBy:"abstained").
 *   - `terminate`      — a hard/normal terminal: budget-exceeded, max-iterations,
 *                        kernel-error, or a delivered success exit.
 *   - `strategy-switch`— escalate to a different reasoning strategy.
 *   - `redirect`       — bounded re-steer that re-enters the loop (grounded-terminal
 *                        redirect, F3 recovery-steering) — carries a remedy.
 *   - `steer`          — advisory guidance injected for the next think turn
 *                        (triage steer, post-condition steer) — carries a remedy.
 *   - `continue`       — no control pressure; proceed with the iteration.
 */
export type ControlAction =
  | "veto"
  | "abstain"
  | "terminate"
  | "strategy-switch"
  | "redirect"
  | "steer"
  | "continue";

// ─── Remedy metadata ─────────────────────────────────────────────────────────
//
// A steer/redirect proposal NAMES the remedy it wants, so the guidance the model
// receives is CORRECT for the actual problem. Audit 02 found F3 emitting the
// wrong remedy — a repeated-tool-failure was steered with a generic "stall"
// message instead of the tool-failure remedy that names the failing tool. Carrying
// the remedy on the proposal makes the remedy auditable and lets the wiring site
// build the right guidance.

/** The class of remedy a steer/redirect proposal is asking for. */
export type RemedyKind =
  | "grounding" // ungrounded terminal → land a substantive tool call first
  | "coverage" // required tools / requirements not yet covered
  | "tool-failure" // a tool path failed → fix the args or try an alternative
  | "required-tool" // a specific required tool was never called
  | "outstanding-requirements" // triage: focus on the named remaining work
  | "budget" // resource exhaustion — wrap up now
  | "loop" // repetition detected → break the loop
  | "none";

/** Remedy metadata attached to a steer/redirect (or informational) proposal. */
export interface ControlRemedy {
  readonly kind: RemedyKind;
  /** Human-readable remedy description (the seed of the guidance text). */
  readonly detail: string;
  /** The specific tool names the remedy references, when applicable. */
  readonly tools?: readonly string[];
}

// ─── Proposal ────────────────────────────────────────────────────────────────

/**
 * "Component X proposes action Y because Z (with remedy metadata)". A control
 * emitter produces a `ControlProposal` (or `null` when it has no opinion this
 * iteration) instead of forcing its action directly.
 */
export interface ControlProposal {
  /** The emitting component (e.g. "loop-detector", "grounded-terminal"). */
  readonly source: string;
  readonly action: ControlAction;
  readonly reason: string;
  readonly confidence: "high" | "medium" | "low";
  /** Present on steer/redirect (and any proposal that names a remedy). */
  readonly remedy?: ControlRemedy;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/** The resolver's output: the ONE winning action + full provenance. */
export interface ControlResolution {
  readonly action: ControlAction;
  /** The winning proposal (null only for the empty/all-continue case). */
  readonly winner: ControlProposal | null;
  readonly reason: string;
  /** Every proposal that was considered (for the trace + diagnostics). */
  readonly proposals: readonly ControlProposal[];
}

// ─── The documented TOTAL ORDER ──────────────────────────────────────────────
//
// Priority index — LOWER index = HIGHER priority (wins). This is the single
// documented precedence over control actions. It (a) makes the pre-F1 arbitrator
// precedence explicit and (b) fixes the P5 race.
//
//   0 veto            A run proven failing (tool-failure evidence + pathological
//                     controller log) cannot be reported as success — the
//                     controllerSignalVeto overrides any success exit. Highest
//                     because it converts a would-be success into a correct
//                     failure and nothing should undo that.
//   1 abstain         An honest forced decline (grounding structurally
//                     impossible). ── P5 FIX ── abstain is STRICTLY ABOVE
//                     strategy-switch: a run that cannot ground its answer must
//                     terminate honestly, NOT be handed to another strategy that
//                     would burn more budget only to abstain again. Before F1 the
//                     switch seam ran first (in-loop) while abstention ran later
//                     (post-loop), so BOTH could fire in one iteration; the total
//                     order guarantees abstain wins when both qualify.
//   2 terminate       A hard/normal terminal — budget-exceeded, max-iterations,
//                     kernel-error, or a delivered success. Below veto/abstain
//                     because those two REINTERPRET a terminal (fail / decline);
//                     a plain terminal must not pre-empt them. (Budget/error
//                     hard-stops are emitted as the SOLE proposal at their site —
//                     the arbitrator's budget pre-guard short-circuits before the
//                     veto is evaluated — so terminate never robs a real veto of
//                     its win; the decision-order corpus proves this.)
//   3 strategy-switch Escalate to a different strategy — a recovery attempt that
//                     spends more budget. Below abstain (P5) and terminate.
//   4 redirect        A bounded, budgeted re-steer that re-enters the loop.
//   5 steer           An advisory guidance injection (does not itself terminate
//                     or redirect the control flow).
//   6 continue        No control pressure.
//
// Ties WITHIN one action: higher `confidence` wins; then the earlier proposal in
// input order (stable — emitters are pushed in a fixed, documented sequence).
const CONTROL_PRIORITY: Readonly<Record<ControlAction, number>> = {
  veto: 0,
  abstain: 1,
  terminate: 2,
  "strategy-switch": 3,
  redirect: 4,
  steer: 5,
  continue: 6,
};

function confidenceRank(c: ControlProposal["confidence"]): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}

/**
 * Resolve a set of `ControlProposal`s into exactly ONE action, using the
 * documented total order (CONTROL_PRIORITY). Pure + deterministic: the same
 * proposal list always resolves to the same action.
 *
 * An empty list (or a list of only `continue` proposals) resolves to `continue`.
 */
export function resolveControlPlane(
  proposals: readonly ControlProposal[],
): ControlResolution {
  if (proposals.length === 0) {
    return { action: "continue", winner: null, reason: "no_control_proposals", proposals };
  }

  let best: ControlProposal | undefined;
  let bestIndex = -1;
  proposals.forEach((p, i) => {
    if (best === undefined) {
      best = p;
      bestIndex = i;
      return;
    }
    const byAction = CONTROL_PRIORITY[p.action] - CONTROL_PRIORITY[best.action];
    if (byAction < 0) {
      best = p;
      bestIndex = i;
      return;
    }
    if (byAction === 0) {
      // Same action — higher confidence wins; ties keep the earlier proposal
      // (stable: bestIndex < i so we do NOT replace on an equal-confidence tie).
      const byConf = confidenceRank(p.confidence) - confidenceRank(best.confidence);
      if (byConf > 0) {
        best = p;
        bestIndex = i;
      }
    }
  });

  // `best` is defined (proposals.length > 0). bestIndex silences unused-var while
  // documenting the stable-tie invariant (we keep the earliest at equal rank).
  void bestIndex;
  const winner = best as ControlProposal;
  return {
    action: winner.action,
    winner,
    reason: winner.reason,
    proposals,
  };
}
