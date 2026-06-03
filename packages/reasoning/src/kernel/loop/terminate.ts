// Single-owner termination helper (Stage 5 W4 — FIX-18 / NS §2.5).
//
// Background: the kernel had 9 sites that transitioned `status: "done"` —
// 8 in `kernel/loop/runner.ts` (low-delta guard, fallback deliver, harness-
// deliverable, oracle-forced, loop-graceful, required-tool-nudge-exhausted,
// and the loop-detection escape paths) plus 1 in
// `kernel/capabilities/decide/arbitrator.ts` (the verdict oracle). CHANGE A
// wired the oracle into 1 of 9 sites; the other 8 bypassed it. This was the
// failure-corpus root cause per North Star §2.5.
//
// Resolution: every imperative termination site outside the Arbitrator now
// routes through `terminate()` below. The Arbitrator stays the canonical
// verdict-driven oracle (its own `transitionState` call is allowed); this
// helper owns the imperative paths that predate the oracle and can't easily
// be folded into a Verdict.
//
// CI lint at `scripts/check-termination-paths.sh` fails if a new direct
// `status: "done"` transition appears outside this helper or the Arbitrator.

import type { Deliverable, Rationale } from "@reactive-agents/core";
import { deliverableToContent } from "@reactive-agents/core";
import type { KernelMeta, KernelState } from "../state/kernel-state.js";
import { transitionState } from "../state/kernel-state.js";
import { commitDeliverable } from "./runner-helpers/deliverable.js";
import {
  verify as verifyPostConditions,
  describeUnmet,
} from "../capabilities/verify/post-conditions.js";

/**
 * Enumerable union of kernel-emitted termination reason codes (R23 surface).
 * Sources: runner.ts `terminate()` callers, arbitrator.ts `applyTermination()`
 * literal `terminatedBy` values, oracle-decision passthrough reasons, and
 * dispatcher intermediates observed on `state.meta.terminatedBy`. Templated
 * reasons (`controller_early_stop:<reason>`, `loop_detected:<reason>`) are
 * omitted — callers should prefix-match. Enforces only `TerminateOptions.reason`;
 * `Verdict.terminatedBy` in arbitrator.ts is still `string` (followup).
 */
export type TerminateReason =
  | "low_delta_guard" | "switching_exhausted" | "harness_deliverable"
  | "harness_synthesis"
  | "oracle_forced" | "loop_graceful" | "budget_exceeded" | "max_iterations"
  | "kernel_error" | "controller_signal_veto" | "loop_detected_with_veto"
  | "end_turn" | "final_answer_tool" | "final_answer" | "llm_end_turn"
  | "content_stable" | "final_answer_regex" | "entropy_converged"
  | "dispatcher-early-stop" | "dispatcher-strategy-switch"
  // User-initiated stop via the RunController checkpoint (P1 mission 2B —
  // routed through terminate() so the stop-checkpoint path stops bypassing the
  // single-owner termination + output-writer invariants).
  | "stop_requested";

export type TerminateOptions = {
  /**
   * The `terminatedBy` reason. REQUIRED — every termination must declare why.
   * Common values: `"low_delta_guard"`, `"harness_deliverable"`, `"oracle_forced"`,
   * `"loop_graceful"`, `"dispatcher-early-stop"`, `"dispatcher-strategy-switch"`.
   *
   * Constrained to `TerminateReason` so the kernel-emitted termination surface
   * stays enumerable for downstream assertions (R23 / M9 oracle witness).
   */
  readonly reason: TerminateReason;
  /**
   * The user-visible output, as a typed {@link Deliverable} (P1 mission 2B).
   *
   * `terminate()` does NOT write `state.output` from a raw string — that would
   * make it a string→output launderer and defeat the typed-provenance contract.
   * Callers construct the Deliverable that proves provenance (model_synthesis
   * for model-authored text, tool_artifact/harness_synthesis for assembled
   * observations, sentinel for empty/abort). `terminate()` finalizes status and
   * delegates the output string to the single writer `commitDeliverable`.
   */
  readonly deliverable: Deliverable;
  /**
   * Additional KernelMeta fields to merge alongside `terminatedBy`. Common use:
   * `previousTerminatedBy`, `escalateTo`, etc. Do NOT pass `terminatedBy` here
   * — that's set from `reason`.
   */
  readonly extraMeta?: Partial<KernelMeta>;
  /**
   * Optional structured rationale for the termination (v0.11.x).
   * When provided, surfaces on `KernelStateSnapshotEvent.terminationRationale`.
   * Use when `reason` is opaque (e.g. "quality_threshold") and the rationale
   * carries the threshold/score context that makes the choice auditable.
   */
  readonly rationale?: Rationale;
};

// Sprint-1 A4 (2026-06-02): RA_POST_CONDITIONS flag deleted. Terminal
// post-condition verification is unconditional — closes the false-success
// hole at the imperative gateway. Aligns with canonical-harness-core
// part 4 (state-grounded verification as success authority).

/**
 * Terminal PostCondition hard-stop — the success authority at the single-owner
 * imperative gateway (the brief's "verifier.ts + terminate.ts" wiring).
 *
 * The Arbitrator's `applyPostConditionGate` STEERS mid-loop: a would-be
 * exit-success with unmet conditions is converted to a re-entry escalation so
 * the model gets another shot. But the imperative paths that route through
 * `terminate()` (stall/harness-deliverable, loop-graceful, oracle-forced,
 * required-tool-nudge-exhausted) bypass the Arbitrator's verdict — an exhausted
 * stall can force-deliver around the gated verdict and report a FALSE success
 * (cogito GitHub-MCP: result.success=true with ./commits.md never written).
 *
 * This gate closes that hole: by default (opt-out via RA_POST_CONDITIONS=0) AND
 * with a non-empty
 * stored condition set AND a ledger that leaves a condition unmet, the terminal
 * state resolves to `status:"failed"` (honest partial failure) regardless of
 * `opts.reason` — even though output may already be assembled. `status:"failed"`
 * is the EXISTING channel that surfaces `result.success === false` (same one
 * max_iterations / kernel_error / the §9.0 verifier-rejection use). The
 * transitionState invariant nulls the output on failure, matching the §9.0
 * precedent.
 *
 * Reads the conditions DERIVED ONCE at run-start and stored on
 * `state.meta.postConditions` — the SAME set the Arbitrator's steer gate reads.
 * NO LLM, NO fs: `verifyPostConditions` is a pure ledger scan.
 *
 * Opt-out (RA_POST_CONDITIONS=0) or no stored conditions → byte-identical
 * pass-through to the original done-transition below.
 */
function applyTerminalPostConditionGate(
  state: KernelState,
  opts: TerminateOptions,
): KernelState | null {
  const conditions = state.meta.postConditions;
  if (!conditions || conditions.length === 0) return null;

  const result = verifyPostConditions(conditions, state.steps, {
    output: deliverableToContent(opts.deliverable),
  });
  if (result.unmet.length === 0) return null; // state-grounded success — proceed

  // Unmet post-conditions at a forced/imperative termination: refuse success.
  // The run cannot honestly report a delivered success while a required
  // deliverable was never produced. status:"failed" → result.success=false.
  return transitionState(state, {
    status: "failed" as const,
    error:
      `Post-condition(s) unmet at termination (terminatedBy=${opts.reason}): ` +
      describeUnmet(result.unmet),
    meta: {
      ...state.meta,
      terminatedBy: opts.reason,
      previousTerminatedBy: state.meta.terminatedBy,
      ...(opts.rationale ? { terminationRationale: opts.rationale } : {}),
      ...(opts.extraMeta ?? {}),
    },
  });
}

/**
 * Transition the kernel to `status: "done"` with `terminatedBy` and `output`
 * recorded. Single-owner gateway for all imperative termination paths.
 *
 * The Arbitrator's verdict-driven exit-success branch is the only sanctioned
 * caller outside this helper — see `kernel/capabilities/decide/arbitrator.ts`.
 *
 * Terminal PostCondition authority (default-on; opt-out via RA_POST_CONDITIONS=0): before recording a
 * "done" transition, an unmet stored post-condition demotes the terminal state
 * to "failed" (honest failure) — see `applyTerminalPostConditionGate`.
 */
export const terminate = (state: KernelState, opts: TerminateOptions): KernelState => {
  const failed = applyTerminalPostConditionGate(state, opts);
  if (failed) return failed;
  // Compose the two single-owner concepts (P1 mission 2B): `terminate` owns the
  // status/terminatedBy finalize; `commitDeliverable` owns the output string.
  // Set status:"done" + meta FIRST (no `output` key — an output-only patch on a
  // `done` state sticks per the transitionState invariant), THEN funnel the
  // output through the single writer. NO parallel output-writing path is opened.
  const done = transitionState(state, {
    status: "done" as const,
    meta: {
      ...state.meta,
      terminatedBy: opts.reason,
      ...(opts.rationale ? { terminationRationale: opts.rationale } : {}),
      ...(opts.extraMeta ?? {}),
    },
  });
  return commitDeliverable(done, opts.deliverable);
};
