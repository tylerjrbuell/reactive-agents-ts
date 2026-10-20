/**
 * Think phase — context-pressure threshold constants.
 *
 * Moved verbatim from `think.ts` (GH #219 / HS-249 decomposition). Per-tier
 * token-pressure thresholds and the `shouldNarrowToFinalAnswerOnly` flag —
 * the values the tool-surface resolver's pressure stage composes with
 * (`build-think-request.ts`) and the run-hard checkpoint mirrors
 * (`kernel/loop/auto-checkpoint.ts`, via the `think.ts` re-export).
 */

/** Per-tier context pressure thresholds — local models get narrowed earlier. */
export const CONTEXT_PRESSURE_THRESHOLDS: Record<string, number> = {
  local: 0.80,
  mid: 0.85,
  large: 0.90,
  frontier: 0.95,
};

/** Returns true when token pressure is critical — only final-answer should be offered. */
export function shouldNarrowToFinalAnswerOnly(opts: {
  estimatedTokens: number
  maxTokens: number
  tier?: string
}): boolean {
  const threshold = CONTEXT_PRESSURE_THRESHOLDS[opts.tier ?? "mid"] ?? 0.85;
  return opts.estimatedTokens / opts.maxTokens >= threshold
}
