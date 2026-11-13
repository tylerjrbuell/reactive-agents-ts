/**
 * loop-detection-config.ts — loop detection configuration for kernel execution.
 * Moved out of kernel-state.ts (LOC-pinned) and re-exported there; the
 * `guidanceCycles` field is new (graduated response, runner-helpers/loop-guidance.ts).
 */
export interface LoopDetectionConfig {
  /** Max consecutive calls to the same tool with the same args before aborting (default: 3) */
  readonly maxSameToolCalls?: number;
  /** Max identical thought strings in the last N steps before aborting (default: 3) */
  readonly maxRepeatedThoughts?: number;
  /** Max consecutive thought steps without any tool action before aborting (default: 3) */
  readonly maxConsecutiveThoughts?: number;
  /**
   * Guidance cycles a detection gets before the run may be stopped or switched
   * (a stretch of zero progress; any progress action resets it). Default scales
   * with `maxIterations` (see `loopGuidanceBudget`); `0` restores stop-on-first-detection.
   */
  readonly guidanceCycles?: number;
}
