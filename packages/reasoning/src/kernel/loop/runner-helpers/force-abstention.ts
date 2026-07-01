/**
 * runner-helpers/force-abstention.ts — Pure harness-forced abstention decision.
 *
 * Task 6 (O3 abstention feature): when the model did NOT abstain but grounding
 * is structurally impossible, the harness forces an `abstained` terminal instead
 * of grinding to `max_iterations` or letting fabrication through.
 *
 * This module is PURE — no imports from kernel-state or Effect. The runner feeds
 * it inputs derived from kernel state; the runner owns all state mutations.
 *
 * Seam boundary: the MODEL-INITIATED abstain path (`think.ts` legitimacy gate,
 * commits 0a5a6139 + cc560076) is a separate seam. This module only covers the
 * HARNESS-FORCED path at the loop-exhaustion / max-iterations decision site.
 */

export interface ForceAbstentionInput {
  /** True when a declared required tool is absent from the registered schema set. */
  readonly requiredToolUnavailable: boolean;
  /** The unsatisfied required-tool names (empty array when not derivable). */
  readonly missingRequiredTools: readonly string[];
  /**
   * Sum of Arbitrator synthesis retries (`state.meta.synthesisRetryCount`) and
   * block-mode grounding retries (`state.meta.groundingBlockRetry`). Fallback: 0.
   */
  readonly ungroundedSynthesisRejections: number;
  /**
   * Budget iterations left this run (`maxIterations - state.iteration` clamped ≥ 0).
   * Typically 0 at the exhaustion site. The runner special-cases the pre-loop
   * guard situation (required tool unavailable at iteration=0) by treating
   * iterationsRemaining as 0 — no iterations can fix a structurally missing tool.
   */
  readonly iterationsRemaining: number;
  /** True when `countDeliverableCandidates(state) > 0`. Never forces over a real deliverable. */
  readonly hasDeliverable: boolean;
}

export interface ForcedAbstention {
  readonly force: true;
  readonly reason: string;
  readonly missing: string[];
}

/** Threshold: ≥2 ungrounded synthesis rejections → force abstention. */
export const FORCE_UNGROUNDED_THRESHOLD = 2;

/**
 * Decide whether the harness should force an honest `abstained` terminal instead
 * of grinding to `max_iterations` or letting fabrication leak. Never overrides a
 * genuine deliverable.
 *
 * Returns non-null when the harness MUST force abstention; null when the run
 * should continue normally (existing exhaustion / done / failed path unchanged).
 */
export function decideForcedAbstention(i: ForceAbstentionInput): ForcedAbstention | null {
  if (i.hasDeliverable) return null;
  if (i.requiredToolUnavailable && i.iterationsRemaining <= 0) {
    return {
      force: true,
      reason: "required tool unavailable; could not ground an answer",
      missing: i.missingRequiredTools.map((t) => `tool:${t}`),
    };
  }
  if (i.ungroundedSynthesisRejections >= FORCE_UNGROUNDED_THRESHOLD) {
    return {
      force: true,
      reason: "could not ground an answer in available evidence",
      missing: [],
    };
  }
  return null;
}
