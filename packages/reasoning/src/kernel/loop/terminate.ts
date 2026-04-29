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

import type { KernelMeta, KernelState } from "../state/kernel-state.js";
import { transitionState } from "../state/kernel-state.js";

export type TerminateOptions = {
  /**
   * The `terminatedBy` reason. REQUIRED — every termination must declare why.
   * Common values: `"low_delta_guard"`, `"harness_deliverable"`, `"oracle_forced"`,
   * `"loop_graceful"`, `"dispatcher-early-stop"`, `"dispatcher-strategy-switch"`.
   */
  readonly reason: string;
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
      ...(opts.extraMeta ?? {}),
    },
  });
