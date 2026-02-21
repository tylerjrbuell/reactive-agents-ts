import { Effect } from "effect";
import type { DimensionScore } from "../types/eval-result.js";

/**
 * Cost-efficiency scorer: measures quality per dollar spent.
 * Uses the formula: score = overallQuality / max(costUsd, 0.0001)
 * Normalized so that $0.001 at quality 1.0 = 1.0 (best), higher cost = lower score.
 */
export const scoreCostEfficiency = (params: {
  overallQualityScore: number;
  costUsd: number;
  caseId: string;
}): Effect.Effect<DimensionScore> =>
  Effect.sync(() => {
    const { overallQualityScore, costUsd } = params;
    const cost = Math.max(costUsd, 0.0001);

    // Reference: $0.001 per quality point = 1.0 score
    // Higher cost or lower quality reduces the score
    const rawEfficiency = overallQualityScore / cost / 1000;
    const score = Math.max(0, Math.min(1, rawEfficiency));

    return {
      dimension: "cost-efficiency",
      score,
      details: `Quality: ${overallQualityScore.toFixed(3)}, Cost: $${costUsd.toFixed(5)}`,
    } satisfies DimensionScore;
  });
