import type { ModelCalibration } from "@reactive-agents/llm-provider";
import type { ModelObservations, RunObservation } from "./observations-types.js";

/** Minimum samples before observations override prior. */
export const OVERRIDE_THRESHOLD = 5;

/**
 * Merge locally-observed behavior into the shipped prior. Currently updates:
 *   - parallelCallCapability (reliable / partial / sequential-only) from observed
 *     parallel-turn frequency.
 *   - classifierReliability from the classifier false-positive rate.
 *   - actOrAnswer (proactive / retry / off) from no-call stalls and forced-call
 *     outcomes ({@link deriveActOrAnswer}).
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

  // ── actOrAnswer: derived from no-call stalls and forced-call outcomes ──
  const actOrAnswer = deriveActOrAnswer(observations.runs, prior.actOrAnswer);
  if (actOrAnswer !== undefined && actOrAnswer !== prior.actOrAnswer) {
    next = { ...next, actOrAnswer };
  }

  return next;
}

/** Forced calls needed before a low success rate may turn forcing off (fewer is noise). */
export const ACT_OR_ANSWER_MIN_FORCED = 5;
/** Below this forced-call success rate, forcing does more harm than good (qwen3:4b forced writes: 0/18 ok). */
export const ACT_OR_ANSWER_OFF_SUCCESS = 0.4;
/** Unforced tool-work turns needed before the stall rate may decide (fewer is noise: one stall would swing it 10pp+). */
export const ACT_OR_ANSWER_MIN_UNFORCED_TURNS = 10;
/** Below this stall rate (stalls per unforced tool-work turn), there is too little to rescue to pay for forcing. */
export const ACT_OR_ANSWER_OFF_STALL_RATE = 0.05;
/** At or above this success rate, forced calls are reliable enough to send first (cogito:8b). */
export const ACT_OR_ANSWER_PROACTIVE_SUCCESS = 0.7;
/** At or above this stall rate, stalls are common enough that skipping the prose turn pays. */
export const ACT_OR_ANSWER_PROACTIVE_STALL_RATE = 0.15;

type ActOrAnswerChoice = NonNullable<ModelCalibration["actOrAnswer"]>;

/** A run that recorded every act-or-answer count (runs from older observation files do not). */
function hasActOrAnswerCounts(r: RunObservation): r is RunObservation & {
  readonly noCallStallTurns: number;
  readonly unforcedToolWorkTurns: number;
  readonly forcedCalls: number;
  readonly forcedCallsSucceeded: number;
} {
  return (
    typeof r.noCallStallTurns === "number" &&
    typeof r.unforcedToolWorkTurns === "number" &&
    typeof r.forcedCalls === "number" &&
    typeof r.forcedCallsSucceeded === "number"
  );
}

/**
 * The learned act-or-answer choice, or `undefined` while fewer than
 * {@link OVERRIDE_THRESHOLD} runs carry the counts. Rules, first match wins:
 * enough forced calls that mostly fail → off (measured under forcing); fewer
 * than {@link ACT_OR_ANSWER_MIN_UNFORCED_TURNS} unforced tool-work turns →
 * `prior` (the stall rate is a property of the model when NOT forced, so a
 * mostly-forced history carries no evidence to change it; this is what keeps
 * proactive from flipping itself off); almost no stalls → off; forced calls
 * mostly succeed and stalls are common → proactive; otherwise retry.
 */
export function deriveActOrAnswer(
  runs: readonly RunObservation[],
  prior?: ActOrAnswerChoice,
): ActOrAnswerChoice | undefined {
  const counted = runs.filter(hasActOrAnswerCounts);
  if (counted.length < OVERRIDE_THRESHOLD) return undefined;
  const sum = (f: (r: (typeof counted)[number]) => number): number => counted.reduce((n, r) => n + f(r), 0);
  const forced = sum((r) => r.forcedCalls);
  const succeeded = sum((r) => r.forcedCallsSucceeded);
  const successRate = forced > 0 ? succeeded / forced : undefined;
  if (forced >= ACT_OR_ANSWER_MIN_FORCED && successRate !== undefined && successRate < ACT_OR_ANSWER_OFF_SUCCESS) return "off";
  const unforced = sum((r) => r.unforcedToolWorkTurns);
  if (unforced < ACT_OR_ANSWER_MIN_UNFORCED_TURNS) return prior;
  const stallRate = sum((r) => r.noCallStallTurns) / unforced;
  if (stallRate < ACT_OR_ANSWER_OFF_STALL_RATE) return "off";
  if (successRate !== undefined && successRate >= ACT_OR_ANSWER_PROACTIVE_SUCCESS && stallRate >= ACT_OR_ANSWER_PROACTIVE_STALL_RATE) {
    return "proactive";
  }
  return "retry";
}

function categorizeParallelRate(rate: number): ModelCalibration["parallelCallCapability"] {
  if (rate >= 0.8) return "reliable";
  if (rate < 0.2) return "sequential-only";
  return "partial";
}
