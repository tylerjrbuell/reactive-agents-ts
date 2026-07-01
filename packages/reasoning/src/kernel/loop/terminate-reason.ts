/**
 * loop/terminate-reason.ts — Leaf type module for the kernel termination
 * reason surface.
 *
 * Extracted from `terminate.ts` (GH #184, cycle break) so the
 * `runner-helpers/deliverable.ts` ↔ `terminate.ts` import cycle is severed:
 * `deliverable.ts` only needed the `TerminateReason` TYPE from `terminate.ts`,
 * while `terminate.ts` needs the `commitDeliverable` RUNTIME function from
 * `deliverable.ts`. Hoisting the shared type to this dependency-free leaf lets
 * both files import the type from here without the mutual edge.
 *
 * This module imports NOTHING — keep it that way so it stays a true leaf.
 */

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
  | "stop_requested"
  // Durable HITL (Phase D): the act capability gated a flagged tool call and
  // paused the run for human approval. A NON-FAILURE terminal reason — the
  // terminal post-condition gate passes it through (a paused run has
  // intentionally not met its post-conditions and must not be demoted to
  // `failed`). The engine detects this reason to persist `awaiting-approval`.
  | "awaiting-approval"
  // O3: model honestly declined — cannot ground a response or a required input
  // is unavailable. Non-failure terminal (goalAchieved=false, success=false but
  // not a crash). Task 5 (legitimacy gate) + Task 6 (forced path) extend this.
  | "abstained";
