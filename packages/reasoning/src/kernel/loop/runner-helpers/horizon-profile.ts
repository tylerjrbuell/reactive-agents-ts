/**
 * runner-helpers/horizon-profile.ts — opt-in "long horizon" guard scaling.
 *
 * Task A2 of the 2026-07-08 meta-loop execution plan (Phase 3.5 instrument).
 * The audit-02-#12 guard constants were tuned for <10-iteration runs and fire
 * prematurely on long-horizon (≥30-iter) research-and-deliver tasks: a stall
 * threshold of 2 kills a run after two non-artifact iterations even mid-gather,
 * `maxConsecutiveThoughts: 3` amputates a planning burst, a one-shot redirect
 * budget is spent before a 50-iter run has oriented, and the run-cumulative
 * controller-veto counters accrue forever with no decay.
 *
 * This profile scales those constants PROPORTIONALLY to `maxIterations` instead
 * of using absolute counts, and windows the veto counters. It is **opt-in**:
 * `resolveHorizonProfile` returns `undefined` unless `horizonProfile === "long"`,
 * and EVERY consumer falls back to its existing literal when the resolved
 * profile is absent — so a run WITHOUT the profile is byte-identical to today.
 *
 * Surface note: the user-facing wither `.withLongHorizon()` (or the policy
 * compiler of Phase 6 / plan G1) sets the `horizonProfile: "long"` field on
 * `KernelRunOptions`; that field is the plumbing this module reads. G1 states
 * "`horizonProfile` subsumes A2's flag" — the config field IS the forward
 * contract. (The runtime wither lives in packages/runtime and is out of A2's
 * scope; it would set exactly this field.)
 */

/**
 * Resolved long-horizon guard constants. Every field is an ABSOLUTE resolved
 * value the consumer swaps in for its literal, EXCEPT the two additive `*Bonus`
 * fields (the base they add to is tier-dependent and resolved at the call site).
 */
export interface HorizonProfile {
  /** Stall threshold when reactive intelligence is INACTIVE (replaces `2`). */
  readonly stallThreshold: number;
  /** Stall threshold when reactive intelligence is ACTIVE (replaces `4`). */
  readonly stallThresholdRI: number;
  /** Loop-detector consecutive-thought cap (replaces `3`; 5 for ≥30 iter). */
  readonly maxConsecutiveThoughts: number;
  /** Consecutive-ignored-nudge tolerance (replaces StallPolicy default `2`). */
  readonly ignoredNudgeTolerance: number;
  /**
   * Added to `maxRequiredToolRetries` to form the total required-tool nudge cap
   * (replaces the absolute `+ 2`).
   */
  readonly requiredToolNudgeBonus: number;
  /** Grounding / coverage one-shot redirect budget (replaces `1`; 2 for ≥30 iter). */
  readonly redirectBudget: number;
  /** Added to the tier `oracleNudgeLimit` before force-exit (scales patience up). */
  readonly oracleNudgeBonus: number;
  /**
   * Controller veto counters (`stall-detect` / `tool-inject`) window: only the
   * last N controller-decision-log entries count toward the veto thresholds
   * under the profile (instead of the run-cumulative log).
   */
  readonly vetoDecisionWindow: number;
}

/** Iterations at/above which the "big" scalings (redirect budget, consecutive
 *  thoughts) engage — the audit's long-horizon boundary. */
export const HORIZON_LONG_ITER_THRESHOLD = 30;

/** Windowed veto counter width under the profile (last N decision-log entries). */
export const HORIZON_VETO_WINDOW = 10;

/**
 * Resolve the scaled guard constants for this run, or `undefined` when the
 * profile is off. `undefined` is the byte-identical signal: consumers use
 * `resolved?.field ?? <existing literal>`.
 */
export function resolveHorizonProfile(opts: {
  readonly horizonProfile?: "long" | undefined;
  readonly maxIterations: number;
}): HorizonProfile | undefined {
  if (opts.horizonProfile !== "long") return undefined;
  const maxIter = Math.max(1, Math.floor(opts.maxIterations));
  const tenth = Math.ceil(0.1 * maxIter);
  const isLong = maxIter >= HORIZON_LONG_ITER_THRESHOLD;
  return {
    stallThreshold: Math.max(2, tenth),
    stallThresholdRI: Math.max(4, tenth),
    maxConsecutiveThoughts: isLong ? 5 : 3,
    ignoredNudgeTolerance: Math.max(2, tenth),
    requiredToolNudgeBonus: Math.max(2, tenth),
    redirectBudget: isLong ? 2 : 1,
    oracleNudgeBonus: Math.ceil(0.05 * maxIter),
    vetoDecisionWindow: HORIZON_VETO_WINDOW,
  };
}

/**
 * Window a controller-decision log to its last `window` entries. `undefined`
 * (profile off) or a non-positive window returns the log unchanged — the
 * run-cumulative behavior. Entries are appended ~once per iteration by the
 * reactive observer, so the last-N-entries window approximates "last N
 * iterations"; a fully iteration-exact window is deferred to Wave E's windowed
 * health fields (plan 02-#2 → E2).
 */
export function windowDecisions(
  log: readonly string[],
  window: number | undefined,
): readonly string[] {
  if (window === undefined || window <= 0) return log;
  return log.length > window ? log.slice(-window) : log;
}
