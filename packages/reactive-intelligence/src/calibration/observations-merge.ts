import type { ModelCalibration } from "@reactive-agents/llm-provider";
import type { ModelObservations } from "./observations-types.js";

/** Minimum samples before observations override prior. */
export const OVERRIDE_THRESHOLD = 5;

/**
 * Merge locally-observed behavior into the shipped prior. Currently updates:
 *   - parallelCallCapability (reliable / partial / sequential-only) from observed
 *     parallel-turn frequency.
 *
 * Returns the prior by identity when the override threshold is not met, so
 * callers can detect "no change" without deep-equality checks.
 */
export function mergeObservationsIntoPrior(
  prior: ModelCalibration,
  observations: ModelObservations,
): ModelCalibration {
  if (observations.runs.length < OVERRIDE_THRESHOLD) return prior;

  let next: ModelCalibration = prior;

  const parallelRate =
    observations.runs.filter((r) => r.parallelTurnCount > 0).length / observations.runs.length;
  const parallelCapability = categorizeParallelRate(parallelRate);
  if (parallelCapability !== prior.parallelCallCapability) {
    next = { ...next, parallelCallCapability: parallelCapability };
  }

  return next;
}

function categorizeParallelRate(rate: number): ModelCalibration["parallelCallCapability"] {
  if (rate >= 0.8) return "reliable";
  if (rate < 0.2) return "sequential-only";
  return "partial";
}
