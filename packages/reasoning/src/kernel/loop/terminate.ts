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

import type { Rationale } from "@reactive-agents/core";
import type { KernelMeta, KernelState } from "../state/kernel-state.js";
import { transitionState } from "../state/kernel-state.js";

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
  | "dispatcher-early-stop" | "dispatcher-strategy-switch";

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
   * The user-visible output. Empty string is valid (e.g. "deliver what we
   * have" exits before any synthesis). Callers should pass the assembled
   * deliverable, the last substantive thought, or `state.output ?? ""`.
   */
  readonly output: string;
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

/**
 * Transition the kernel to `status: "done"` with `terminatedBy` and `output`
 * recorded. Single-owner gateway for all imperative termination paths.
 *
 * The Arbitrator's verdict-driven exit-success branch is the only sanctioned
 * caller outside this helper — see `kernel/capabilities/decide/arbitrator.ts`.
 */
export const terminate = (state: KernelState, opts: TerminateOptions): KernelState =>
  transitionState(state, {
    status: "done" as const,
    output: opts.output,
    meta: {
      ...state.meta,
      terminatedBy: opts.reason,
      ...(opts.rationale ? { terminationRationale: opts.rationale } : {}),
      ...(opts.extraMeta ?? {}),
    },
  });
