/**
 * terminal-gate.ts — Phase 3 (Terminal Authority, pillar 5): ONE ordered
 * decision pipeline for "may this candidate final answer ship?".
 *
 * Before this module the decision lived in four places that could drift:
 *   1. F1 grounding      — arbitrator `applyGroundedTerminalGate` (zero
 *      substantive tool success on a weak-signal terminal → redirect once,
 *      then hand to the runner's §7.5 forced-abstention).
 *   2. B1 coverage       — `llmEndTurnEvaluator` (required tools unused on
 *      end_turn → redirect once, then accept the next substantive end_turn).
 *   3. P3 coverage       — plan-execute `evaluateGroundedSatisfaction`
 *      (SATISFIED reflection with required tools unexecuted → redirect once,
 *      then abstain).
 *   4. PostCondition steer — arbitrator `applyPostConditionGate` (unmet
 *      post-conditions → uncapped steer; NOT folded in here — it stays the
 *      deliverable-existence authority; this gate owns answer LEGITIMACY).
 *
 * This module owns checks 1-3 plus the P6b independent-checker slot as one
 * ordered pure function. Callers adapt the decision to their local verdict
 * vocabulary (arbitrator → Verdict actions, plan-execute → reflect loop),
 * so behavior stays identical while the LOGIC has a single home.
 *
 * Ordered checks (first non-accept wins):
 *   exemption → grounding (F1) → requirement coverage (B1/P3) → checker (P6b)
 *
 * DOCUMENTED DIVERGENCES (carried verbatim, unify only behind a bench gate):
 *   a) On coverage exhaustion (second violation) the kernel/B1 path ACCEPTS
 *      the answer (the F1 + §7.5 pair still owns the zero-grounding case)
 *      while the plan-execute/P3 path ABSTAINS. `coverageExhaustionPolicy`
 *      makes the caller choose explicitly instead of the two sites silently
 *      disagreeing.
 *   b) Coverage semantics: the kernel counts a required tool as covered when
 *      it was ATTEMPTED (`state.toolsUsed` is written before execution,
 *      act.ts:808) while plan-execute counts only COMPLETED steps. Callers
 *      pass `coveredTools` computed with their own semantics.
 */

import type { ReasoningStep } from "../../../types/index.js";
import { TERMINAL_ANSWER_REASONS } from "../../loop/runner-helpers/grounded-terminal.js";
import {
  describeUnmet,
  verify,
  type PostCondition,
} from "../verify/post-conditions.js";

// ── Decision vocabulary ───────────────────────────────────────────────────────

/** Which ordered check produced the decision. */
export type TerminalGateCheck = "exemption" | "grounding" | "coverage" | "checker";

export type TerminalGateDecision =
  | {
      readonly decision: "accept";
      readonly check: TerminalGateCheck;
      /** Present when a checker ran and its verdict must ride the receipt. */
      readonly checkerCritique?: string;
    }
  | {
      readonly decision: "redirect";
      readonly check: Exclude<TerminalGateCheck, "exemption">;
      /** Harness guidance naming the concrete gap (token-bounded upstream). */
      readonly guidance: string;
      readonly missing: readonly string[];
    }
  | {
      readonly decision: "abstain";
      readonly check: Exclude<TerminalGateCheck, "exemption">;
      readonly reason: string;
      readonly missing: readonly string[];
    };

export type TerminalGateInput = {
  /**
   * The candidate's `terminatedBy` reason. The gate only judges the
   * model-claimed answer family (`TERMINAL_ANSWER_REASONS`) plus the
   * plan-execute synthetic `"plan-execute-satisfied"`; every harness give-up
   * (loop_detected, harness_deliverable, abstained, awaiting-*, …) is exempt —
   * redirecting a forced exit would loop (grounded-terminal.ts:40).
   */
  readonly terminatedBy: string;
  /** Declared required tools (ALL-OF contract). Empty → grounding+coverage vacuous. */
  readonly requiredTools: readonly string[];
  /**
   * Required tools the caller considers covered — divergence (b) above:
   * kernel passes ATTEMPTED (`state.toolsUsed`), plan-execute passes
   * COMPLETED tool_call step names.
   */
  readonly coveredTools: ReadonlySet<string>;
  /**
   * F1 input: at least one substantive (non-meta) tool call succeeded.
   * Computed by the caller (`hasSuccessfulSubstantiveToolCall(steps)` in the
   * kernel; completed tool_call steps in plan-execute).
   */
  readonly hasSubstantiveGrounding: boolean;
  /** One-shot redirect budgets already spent, per check. */
  readonly redirectsSpent: {
    readonly grounding: number;
    readonly coverage: number;
    readonly checker: number;
  };
  /**
   * A2 — redirect budget for the grounding + coverage checks: the number of
   * redirects allowed before the check exhausts. Default 1 (today's one-shot
   * behavior — byte-identical). The long-horizon profile raises it to 2 for
   * ≥30-iteration runs so a redirect is not spent before the run has oriented.
   * The checker slot keeps its own one-shot budget (not scaled by A2).
   */
  readonly redirectBudget?: number;
  /**
   * What happens when coverage is violated AND its redirect is spent:
   * `"accept"` = kernel/B1 semantics (F1+§7.5 still guard zero-grounding),
   * `"abstain"` = plan-execute/P3 semantics (refuse ungrounded SATISFIED).
   */
  readonly coverageExhaustionPolicy: "accept" | "abstain";
  /**
   * B2 (meta-loop 4a) — check 2.5. When a RunContract is supplied ALONGSIDE
   * `evidence`, the coverage check (2) consumes REQUIREMENT satisfaction —
   * every requirement's deterministic PostCondition verified against the run's
   * step ledger with the same pure `verify()` gate (artifact-produced via the
   * `isArtifactProduced` scan; tool-coverage via ToolCalled) — instead of the
   * tool-name diff. `missing` then names the UNSATISFIED requirements.
   *
   * Absent (or `evidence` absent) → the tool-name coverage path below runs
   * exactly as pre-B2, so a run without a contract is byte-identical. Only the
   * requirements' deterministic `condition`s participate; the base
   * self-critique answer requirement (no condition) never blocks the gate.
   *
   * Structurally a subset of `RunContract` (the full contract is assignable).
   */
  readonly contract?: {
    readonly requirements: readonly {
      readonly spec: {
        readonly condition?: PostCondition;
        readonly description: string;
      };
    }[];
    readonly postConditions: readonly PostCondition[];
  };
  /**
   * B2 — the ledger + assembled output the contract's requirements are verified
   * against. Consulted ONLY when `contract` is also present. `steps` is the run
   * ledger (`state.steps`); `output` feeds OutputContains requirements.
   */
  readonly evidence?: {
    readonly steps: readonly ReasoningStep[];
    readonly output: string;
  };
  /**
   * P6b slot: verdict from the independent checker, if one is configured AND
   * the caller already ran it for this candidate. `undefined` = no checker —
   * slot is inert (default; today's shipped behavior).
   */
  readonly checkerVerdict?: {
    readonly approved: boolean;
    readonly critique: string;
  };
  /** Guidance builders — injected so this module stays dependency-light. */
  readonly buildGroundingGuidance: () => string;
  readonly buildCoverageGuidance: (missing: readonly string[]) => string;
};

/**
 * The plan-execute reflect loop has no `terminatedBy` — a SATISFIED
 * reflection IS its terminal claim. It enters the gate under this reason.
 */
export const PLAN_EXECUTE_SATISFIED = "plan-execute-satisfied";

/**
 * Reflexion's critique-SATISFIED claim (Gate A). Coverage semantics: uncapped
 * redirect — every violation forces another improve pass; the strategy's
 * maxRetries loop is the bound, not this gate's redirect budget.
 */
export const REFLEXION_SATISFIED = "reflexion-satisfied";

const GATED_REASONS: ReadonlySet<string> = new Set([
  ...TERMINAL_ANSWER_REASONS,
  PLAN_EXECUTE_SATISFIED,
  REFLEXION_SATISFIED,
]);

// ── B2 check-2.5 requirement coverage ─────────────────────────────────────────

/**
 * The contract's UNSATISFIED requirement descriptions — the requirement-aware
 * coverage set. Verifies every requirement's deterministic PostCondition
 * against the run ledger with the pure `verify()` gate, then names each unmet
 * condition by its owning requirement's description (falling back to a
 * description of the condition itself). Requirements with no `condition` (the
 * base self-critique answer) contribute nothing — they are not deterministically
 * checkable and must never block the gate.
 */
function unsatisfiedRequirements(
  contract: NonNullable<TerminalGateInput["contract"]>,
  evidence: NonNullable<TerminalGateInput["evidence"]>,
): readonly string[] {
  const { unmet } = verify(contract.postConditions, evidence.steps, {
    output: evidence.output,
  });
  return unmet.map((c) => {
    const key = JSON.stringify(c);
    const req = contract.requirements.find(
      (r) => r.spec.condition && JSON.stringify(r.spec.condition) === key,
    );
    return req?.spec.description ?? describeUnmet([c]);
  });
}

// ── The ordered pipeline ──────────────────────────────────────────────────────

export function evaluateTerminalGate(input: TerminalGateInput): TerminalGateDecision {
  // A2 — redirect budget for the grounding/coverage checks (default 1 =
  // today's one-shot). A budget of N accepts redirects while `spent < N`.
  const redirectBudget = input.redirectBudget ?? 1;

  // 0) Exemption — harness give-ups and non-answer terminals pass untouched.
  if (!GATED_REASONS.has(input.terminatedBy)) {
    return { decision: "accept", check: "exemption" };
  }

  // Lever-8 precedent (2026-05-26, carried from applyGroundedTerminalGate):
  // the final-answer TOOL is the model's deliberate structured exit channel —
  // the F1 grounding arm does not fire on it (the PostCondition spine owns
  // steering ungrounded tool exits). Coverage (B1) never fired on it either
  // (llmEndTurnEvaluator only sees stopReason end_turn). Exempt, verbatim.
  const isDeliberateToolExit = input.terminatedBy === "final_answer_tool";

  // 1) Grounding (F1): requiredTools declared + ZERO substantive successes.
  if (
    !isDeliberateToolExit &&
    input.requiredTools.length > 0 &&
    !input.hasSubstantiveGrounding
  ) {
    if (input.redirectsSpent.grounding < redirectBudget) {
      return {
        decision: "redirect",
        check: "grounding",
        guidance: input.buildGroundingGuidance(),
        missing: input.requiredTools,
      };
    }
    // Redirect spent: the honest terminal is abstention. The arbitrator
    // adapter maps this back to "accept verbatim" so the runner's §7.5
    // forced-abstention path performs the conversion exactly as today.
    return {
      decision: "abstain",
      check: "grounding",
      reason: "no successful substantive tool call after grounding redirect",
      missing: input.requiredTools,
    };
  }

  // 2) Requirement coverage (B1/P3): some required tools never succeeded.
  //    B2 check 2.5: with a RunContract + evidence, coverage consumes
  //    REQUIREMENT satisfaction (verify against the ledger); otherwise the
  //    tool-name diff (byte-identical to pre-B2).
  const missing =
    input.contract && input.evidence
      ? unsatisfiedRequirements(input.contract, input.evidence)
      : input.requiredTools.filter((t) => !input.coveredTools.has(t));
  if (!isDeliberateToolExit && missing.length > 0) {
    if (input.redirectsSpent.coverage < redirectBudget) {
      return {
        decision: "redirect",
        check: "coverage",
        guidance: input.buildCoverageGuidance(missing),
        missing,
      };
    }
    if (input.coverageExhaustionPolicy === "abstain") {
      return {
        decision: "abstain",
        check: "coverage",
        reason: `required tools never executed: ${missing.join(", ")}`,
        missing,
      };
    }
    // B1 exhaustion: accept the next substantive answer — fall through to 3.
  }

  // 3) Independent checker (P6b slot): only when configured AND consulted.
  if (input.checkerVerdict && !input.checkerVerdict.approved) {
    if (input.redirectsSpent.checker === 0) {
      return {
        decision: "redirect",
        check: "checker",
        guidance: input.checkerVerdict.critique,
        missing: [],
      };
    }
    // Repeat disapproval: ship WITH the verdict recorded — never a loop,
    // never silent (P6b design, capability-gap-synthesis 2026-07-07).
    return {
      decision: "accept",
      check: "checker",
      checkerCritique: input.checkerVerdict.critique,
    };
  }
  if (input.checkerVerdict?.approved) {
    return { decision: "accept", check: "checker" };
  }

  return { decision: "accept", check: missing.length > 0 ? "coverage" : "grounding" };
}
