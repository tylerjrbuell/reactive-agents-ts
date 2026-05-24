/**
 * verbosity-detector.ts — HS-128 per-iteration verbosity diagnostic.
 *
 * Reads the rolling token window snapshotted by think.ts at
 * `state.meta.lastIterationTokens` (capped at last 5 entries). When ≥3
 * samples are available AND the running average exceeds 2× the tier-derived
 * baseline (`profileMaxTokens / 64`), produces a CompressionRecommendation
 * with reason `"verbosity-detected"` so the curator at
 * `kernel/capabilities/attend/context-utils.ts` clamps the prompt budget
 * on the next iteration.
 *
 * Pure helper — no side effects, no Effect, no I/O. The reactive-observer
 * calls `evaluateVerbosity()` and folds the result into KernelState via
 * `transitionState` exactly like the dispatcher's compress-messages branch
 * (#119) does. Decoupled from RI services so verbosity detection fires even
 * when the reactive controller is not configured.
 *
 * L4 evidence: qwen3:14b 1534 tokens vs cogito:14b 393 tokens on identical
 * context-profiles task. Goal: ratio ≤ 200%.
 */

/** Result shape — null when no recommendation should be emitted. */
export interface VerbosityRecommendation {
  readonly targetTokens: number;
  readonly reason: "verbosity-detected";
  readonly recommendedAtIteration: number;
}

/** Default profile max tokens when no tier context is available (local default). */
export const DEFAULT_PROFILE_MAX_TOKENS = 32_768;

/** Minimum samples in the rolling window before evaluating — avoids warmup FP. */
export const MIN_SAMPLES = 3;

/** Multiplier applied to the tier baseline to define the verbosity threshold. */
export const VERBOSITY_MULTIPLIER = 2;

/**
 * Inspect the rolling token window and produce a CompressionRecommendation
 * when verbosity exceeds 2× the tier baseline.
 *
 * @param input.lastIterationTokens - rolling window from KernelMeta (≤5 entries)
 * @param input.iteration - current iteration index (mirrors s.iteration semantics
 *   used by the dispatcher's compress-messages branch — see reactive-observer.ts:388)
 * @param input.profileMaxTokens - tier-derived ceiling; falls back to
 *   {@link DEFAULT_PROFILE_MAX_TOKENS} when undefined (local-tier default)
 * @param input.existingRecommendation - the recommendation already on
 *   state.meta.pendingCompressionRecommendation (if any). Freshness gate:
 *   when the existing recommendation is fresh (delta ≤1), return null so we
 *   don't overwrite a peer source like the dispatcher.
 * @returns A VerbosityRecommendation when the window's running average exceeds
 *   2× baseline AND no fresh existing recommendation blocks us. Null otherwise.
 */
export function evaluateVerbosity(input: {
  readonly lastIterationTokens?: readonly number[];
  readonly iteration: number;
  readonly profileMaxTokens?: number;
  readonly existingRecommendation?: {
    readonly recommendedAtIteration: number;
  };
}): VerbosityRecommendation | null {
  const window = input.lastIterationTokens ?? [];
  if (window.length < MIN_SAMPLES) return null;

  const profileMax = input.profileMaxTokens ?? DEFAULT_PROFILE_MAX_TOKENS;
  // Baseline scales per tier: local/mid/large ~32k → 512; frontier ~128k → 2000.
  const baseline = profileMax / 64;
  const threshold = VERBOSITY_MULTIPLIER * baseline;

  const sum = window.reduce((acc, v) => acc + v, 0);
  const avg = sum / window.length;
  if (avg <= threshold) return null;

  // Freshness gate — mirror the curator-side iter delta ≤1 rule
  // (context-utils.ts:140). When a peer recommendation (e.g. the dispatcher's
  // compress-messages handler) was published this iteration or last, defer to
  // it rather than overwriting.
  const existing = input.existingRecommendation;
  if (existing && input.iteration - existing.recommendedAtIteration <= 1) {
    return null;
  }

  return {
    targetTokens: Math.floor(profileMax / 4),
    reason: "verbosity-detected",
    recommendedAtIteration: input.iteration,
  };
}
