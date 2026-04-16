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

  // ── classifierReliability: derived from false-positive rate across runs ──
  // A "false positive" run = classifier required a tool that was never called.
  const falsePositiveRuns = observations.runs.filter((r) => {
    if (r.classifierRequired.length === 0) return false;
    const called = new Set(r.classifierActuallyCalled);
    return r.classifierRequired.some((name) => !called.has(name));
  }).length;
  const falsePositiveRate = falsePositiveRuns / observations.runs.length;
  const reliability: "high" | "low" = falsePositiveRate >= 0.4 ? "low" : "high";
  if (reliability !== prior.classifierReliability) {
    next = next === prior ? { ...prior, classifierReliability: reliability } : { ...next, classifierReliability: reliability };
  }

  return next;
}

function categorizeParallelRate(rate: number): ModelCalibration["parallelCallCapability"] {
  if (rate >= 0.8) return "reliable";
  if (rate < 0.2) return "sequential-only";
  return "partial";
}
