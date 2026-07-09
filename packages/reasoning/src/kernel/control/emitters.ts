// File: src/kernel/control/emitters.ts
//
// Control Plane — the EMITTERS (F1). Each control component that used to force
// its own action at its own site now has a PURE proposal builder here: it reads
// the already-computed RunAssessment (E1) where relevant and returns a
// `ControlProposal | null` (null = "no opinion this iteration"). The wiring site
// collects the non-null proposals, calls `resolveControlPlane`, and applies the
// ONE winner. This is the "emitters propose, consuming Assessment" half of F1.
//
// DAG law: every emitter READS assessment / ledger-derived facts — none recompute
// assessment or mutate the ledger. Proposals are plain data.
//
// LIFT-GATE DISCIPLINE: the assessment-consulting suppressions (long-gathering
// false-positive fix) are OPT-IN behind the long-horizon profile (`horizonActive`).
// OFF → the emitter proposes exactly what its legacy site forced, so the resolver
// reproduces today's decision (the decision-order corpus pins this). ON → a
// gathering iteration that produced new evidence yields NO stuck proposal.

import type { RunAssessment } from "../assessment/assess.js";
import type { ForcedAbstention } from "../loop/runner-helpers/force-abstention.js";
import type { BudgetSignal, ReactiveDecision } from "../capabilities/decide/arbitrator.js";
import type { ControlProposal } from "./control-plane.js";

// ─── Assessment progress predicate (shared) ──────────────────────────────────
//
// A gathering iteration that produced NEW substantive evidence is PROGRESS — not
// a stall/loop worth killing or switching away from (audit 06 long-gathering
// false-positive). Mirrors guard-adapters.assessmentShowsEvidenceProgress so the
// control plane and the guards agree by construction. OFF profile → false → the
// stuck emitters propose exactly as their legacy site forced.
function evidenceProgress(
  horizonActive: boolean,
  assessment: RunAssessment | undefined,
): boolean {
  return horizonActive && (assessment?.evidenceDelta ?? 0) > 0;
}

// ─── 1. Controller-signal veto ───────────────────────────────────────────────

/**
 * The arbitrator's controllerSignalVeto: a run with tool-failure evidence + a
 * pathological controller log that never escalated → its apparent success is a
 * FAILURE. Highest priority in the total order.
 */
export function proposeFromControllerVeto(
  veto: { readonly veto: true; readonly reason: string } | { readonly veto: false },
): ControlProposal | null {
  if (!veto.veto) return null;
  return { source: "controller-veto", action: "veto", reason: veto.reason, confidence: "high" };
}

// ─── 2. Forced abstention (runner §7.5) ──────────────────────────────────────

/**
 * The harness-forced honest decline: grounding is structurally impossible so the
 * run abstains rather than fabricating or grinding to max_iterations. ── P5 ──
 * abstain STRICTLY outranks strategy-switch in the resolver.
 */
export function proposeFromForcedAbstention(
  forced: ForcedAbstention | null,
): ControlProposal | null {
  if (forced === null) return null;
  return {
    source: "forced-abstention",
    action: "abstain",
    reason: forced.reason,
    confidence: "high",
    remedy: {
      kind: forced.missing.length > 0 ? "required-tool" : "grounding",
      detail: forced.reason,
      ...(forced.missing.length > 0
        ? { tools: forced.missing.map((m) => m.replace(/^tool:/, "")) }
        : {}),
    },
  };
}

// ─── 3. Budget monitor (pre-guard) ───────────────────────────────────────────

/**
 * The BudgetSignal pre-guard. `exceeded` → a hard terminal (the arbitrator's
 * budget pre-guard). `warning`/`ok` → no proposal (advisory only, as today).
 */
export function proposeFromBudgetMonitor(
  budget: BudgetSignal | undefined,
): ControlProposal | null {
  if (budget?.status !== "exceeded") return null;
  return {
    source: "budget-monitor",
    action: "terminate",
    reason: `budget_exceeded: ${budget.reason ?? "budget limit reached"}`,
    confidence: "high",
    remedy: { kind: "budget", detail: budget.reason ?? "budget limit reached" },
  };
}

// ─── 4. Loop detector ────────────────────────────────────────────────────────

/**
 * The loop detector tripped (repetition observed). Its legacy resolution either
 * switches strategy (when switching is enabled + budget remains) or delivers/
 * fails via resolveDetectedLoop. Here it proposes:
 *   - switching viable → `strategy-switch`
 *   - else             → `terminate` (deliver/fail is a terminal)
 *
 * LONG-GATHERING FIX: under the horizon profile, a loop signal on an iteration
 * that produced NEW evidence is a FALSE positive (the model is gathering distinct
 * data, not spinning) → NO proposal. OFF → proposes exactly as the legacy site.
 */
export function proposeFromLoopDetector(args: {
  readonly loopDetected: boolean;
  readonly switchingViable: boolean;
  readonly horizonActive: boolean;
  readonly assessment: RunAssessment | undefined;
}): ControlProposal | null {
  if (!args.loopDetected) return null;
  if (evidenceProgress(args.horizonActive, args.assessment)) return null;
  return args.switchingViable
    ? {
        source: "loop-detector",
        action: "strategy-switch",
        reason: "loop_detected_switch",
        confidence: "high",
      }
    : {
        source: "loop-detector",
        action: "terminate",
        reason: "loop_detected_resolve",
        confidence: "medium",
        remedy: { kind: "loop", detail: "repetition detected — deliver or fail" },
      };
}

// ─── 5. Stall / deliverable guard ────────────────────────────────────────────

/**
 * The harness stall guard fired (consecutiveStalled ≥ threshold). Its legacy
 * action steers toward required tools or takes over completion. Here it proposes
 * a `steer` naming the remedy.
 *
 * LONG-GATHERING FIX: under the horizon profile, a stall signal on an iteration
 * with NEW evidence is a false positive → NO proposal. OFF → proposes as today.
 */
export function proposeFromStallGuard(args: {
  readonly stallTriggered: boolean;
  readonly missingRequiredTools: readonly string[];
  readonly horizonActive: boolean;
  readonly assessment: RunAssessment | undefined;
}): ControlProposal | null {
  if (!args.stallTriggered) return null;
  if (evidenceProgress(args.horizonActive, args.assessment)) return null;
  const named = args.missingRequiredTools;
  return {
    source: "stall-deliverable",
    action: "steer",
    reason: named.length > 0 ? `stall_missing_required_tools: ${named.join(", ")}` : "stall_deliverable",
    confidence: "medium",
    remedy:
      named.length > 0
        ? { kind: "required-tool", detail: `required tool(s) not yet used: ${named.join(", ")}`, tools: named }
        : { kind: "coverage", detail: "no new evidence — deliver what you have or gather more" },
  };
}

// ─── 6. F1 grounded-terminal gate ────────────────────────────────────────────

/**
 * The grounded-terminal invariant gate. An ungrounded terminal (zero successful
 * substantive tool calls) either gets ONE redirect (grounding remedy) or, once
 * the redirect is spent, converts to an honest abstain (owned by §7.5).
 */
export function proposeFromGroundedTerminal(args: {
  readonly ungroundedTerminal: boolean;
  readonly redirectSpent: boolean;
  readonly guidance: string;
  readonly requiredTools: readonly string[];
}): ControlProposal | null {
  if (!args.ungroundedTerminal) return null;
  if (args.redirectSpent) {
    return {
      source: "grounded-terminal",
      action: "abstain",
      reason: "ungrounded_terminal_redirect_spent",
      confidence: "high",
      remedy: { kind: "grounding", detail: "no substantive tool call succeeded", tools: args.requiredTools },
    };
  }
  return {
    source: "grounded-terminal",
    action: "redirect",
    reason: args.guidance,
    confidence: "high",
    remedy: { kind: "grounding", detail: args.guidance, tools: args.requiredTools },
  };
}

// ─── 7. F3 repeated-identical-failure (THE remedy-metadata fix) ───────────────

/**
 * F3 — repeated identical tool failure. Its legacy site built recovery-steering
 * guidance with the trigger label "stall" (audit 02: the WRONG remedy — a
 * repeated tool FAILURE is not a stall; the model needs to fix its tool call, not
 * be told it is stuck). This emitter proposes a `redirect` whose remedy is
 * `tool-failure`, NAMING the failing tool — the correct remedy.
 *
 * ARG-VARIETY SUPPRESSION (audit 02-#11): under the horizon profile, when the
 * failure streak is VARYING its args (the model is exploring fixes, not blindly
 * repeating one bad call) → NO proposal. OFF → proposes as today.
 */
export function proposeFromErrorRecovery(args: {
  readonly repeatedFailureTool: string | null;
  readonly errorClass?: string;
  readonly failedTools: readonly string[];
  readonly guidance: string;
  readonly horizonActive: boolean;
  readonly assessment: RunAssessment | undefined;
}): ControlProposal | null {
  if (args.repeatedFailureTool === null) return null;
  // arg-variety suppression (audit 02-#11) — varying args ⇒ exploring, not stuck.
  if (args.horizonActive && (args.assessment?.health.failureArgVariety ?? 0) > 1) return null;
  return {
    source: "error-recovery",
    action: "redirect",
    reason: args.guidance,
    confidence: "high",
    remedy: {
      // THE FIX: tool-failure remedy (not "stall"), naming the failing tool.
      kind: "tool-failure",
      detail: args.errorClass
        ? `repeated ${args.errorClass} from ${args.repeatedFailureTool} — fix the call or try an alternative`
        : `repeated failure from ${args.repeatedFailureTool} — fix the call or try an alternative`,
      tools: args.failedTools.length > 0 ? args.failedTools : [args.repeatedFailureTool],
    },
  };
}

// ─── 8. RI dispatcher ────────────────────────────────────────────────────────

/**
 * The reactive-intelligence dispatcher's decision, mapped to a proposal at the
 * reasoning-side consumption boundary (reasoning mirrors the RI ControllerDecision
 * shape locally via `ReactiveDecision` — no cross-package dependency, same pattern
 * as termination-oracle.ts). `early-stop` → terminate; `switch-strategy` →
 * strategy-switch; `compress` → no control proposal (a context op, not a control
 * action).
 */
export function proposeFromDispatcher(
  decision: ReactiveDecision | null,
): ControlProposal | null {
  if (decision === null) return null;
  switch (decision.decision) {
    case "early-stop":
      return { source: "ri-dispatcher", action: "terminate", reason: `controller_early_stop: ${decision.reason}`, confidence: "high" };
    case "switch-strategy":
      return { source: "ri-dispatcher", action: "strategy-switch", reason: decision.reason, confidence: "high" };
    case "compress":
      return null;
    default: {
      // Exhaustive: ReactiveDecision.decision is a closed 3-variant union.
      const _exhaust: never = decision.decision;
      void _exhaust;
      return null;
    }
  }
}
