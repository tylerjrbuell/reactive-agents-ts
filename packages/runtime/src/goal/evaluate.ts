import type { GoalCriterion, GoalState, GoalStatus, GoalVerdict } from "@reactive-agents/core";
import type { EvaluateGoalOptions, GoalEvaluation, GoalSegmentResult } from "./types.js";

const DEFAULT_STALL_AFTER = 2;

/** True when a deterministic criterion holds for the segment result. Rubric never holds here. */
function deterministicPasses(c: GoalCriterion, r: GoalSegmentResult): boolean {
  switch (c.check.kind) {
    case "regex": {
      try {
        return new RegExp(c.check.pattern).test(r.output);
      } catch {
        return false; // invalid pattern can never pass
      }
    }
    case "must-include": {
      const v = c.check.value;
      return r.output.includes(v) || (r.deliverables ?? []).some((d) => d.includes(v));
    }
    case "rubric":
      return false;
  }
}

/**
 * Done-authority veto: true unless the segment's run says the work is not done
 * (its exit gate denied completion, or RunContract requirements stayed outstanding).
 * Goal criteria can only confirm a run the kernel let finish; they never outrank it.
 */
function runAllowsDone(r: GoalSegmentResult): boolean {
  if (r.run === undefined) return true;
  return r.run.goalAchieved !== false && (r.run.outstanding?.length ?? 0) === 0;
}

/** Progress authority: the kernel's evidenceDelta when known, else the caller's flag. */
function segmentProgressed(r: GoalSegmentResult): boolean {
  const delta = r.run?.evidenceDelta;
  return delta !== undefined ? delta > 0 : r.progressed === true;
}

/** Name of the first exhausted budget axis, or undefined. */
function exhaustedAxis(s: GoalState): string | undefined {
  const { budget: b, spent, segments } = s;
  if (segments >= b.maxSegments) return "maxSegments";
  if (b.maxCostUsd !== undefined && spent.costUsd >= b.maxCostUsd) return "maxCostUsd";
  if (b.maxTokens !== undefined && spent.tokens >= b.maxTokens) return "maxTokens";
  if (b.maxWallClockMs !== undefined && spent.wallClockMs >= b.maxWallClockMs) return "maxWallClockMs";
  return undefined;
}

/**
 * Pure: fold one finished segment into the goal state and decide the next status.
 *
 * Precedence: achieved > blocked > stalled > budget-exhausted > active.
 * Tier 1 (regex / must-include) is deterministic. Rubric criteria need
 * `options.rubricVerdict`; without it the verdict is `null` (never a guess).
 * Budget is checked at this segment boundary only.
 * When `result.run` is set, the run's own verdict governs: an exit-gate denial
 * or outstanding requirement blocks "achieved", and `evidenceDelta` decides progress.
 */
export function evaluateGoal(
  state: GoalState,
  result: GoalSegmentResult,
  options: EvaluateGoalOptions = {},
): GoalEvaluation {
  const stallAfter = options.stallAfter ?? DEFAULT_STALL_AFTER;
  const rubric = state.criteria.filter((c) => c.check.kind === "rubric");
  const deterministic = state.criteria.filter((c) => c.check.kind !== "rubric");
  const runOk = runAllowsDone(result);
  const deterministicOk = runOk && deterministic.every((c) => deterministicPasses(c, result));

  let verdict: GoalVerdict | null;
  let goalAchieved: boolean | null;
  if (state.criteria.length === 0) {
    verdict = null;
    goalAchieved = null;
  } else if (rubric.length === 0) {
    verdict = deterministicOk ? "achieved" : "progressing";
    goalAchieved = deterministicOk;
  } else {
    const rv = options.rubricVerdict ?? null;
    if (rv === null) {
      verdict = null;
      goalAchieved = null;
    } else if (rv === "achieved") {
      verdict = deterministicOk ? "achieved" : "progressing";
      goalAchieved = deterministicOk;
    } else {
      verdict = rv;
      goalAchieved = false;
    }
  }

  const noDeltaStreak = segmentProgressed(result) ? 0 : state.noDeltaStreak + 1;
  const next: GoalState = {
    ...state,
    segments: state.segments + 1,
    spent: {
      costUsd: state.spent.costUsd + (result.costUsd ?? 0),
      tokens: state.spent.tokens + (result.tokens ?? 0),
      wallClockMs: state.spent.wallClockMs + (result.durationMs ?? 0),
    },
    verdictHistory: [...state.verdictHistory, verdict],
    noDeltaStreak,
  };

  let status: GoalStatus = "active";
  let reason = "continuing";
  const axis = exhaustedAxis(next);
  if (verdict === "achieved") {
    status = "achieved";
    reason = "all criteria satisfied";
  } else if (verdict === "blocked") {
    status = "blocked";
    reason = "checker reports blocked";
  } else if (verdict === "stalled" || noDeltaStreak >= stallAfter) {
    status = "stalled";
    reason = verdict === "stalled" ? "checker reports stalled" : `no new evidence for ${noDeltaStreak} segments`;
  } else if (axis !== undefined) {
    status = "budget-exhausted";
    reason = `budget exhausted: ${axis}`;
  } else if (!runOk) {
    reason = "the run's exit gate did not accept completion";
  }

  return { state: { ...next, status }, verdict, goalAchieved, reason };
}
