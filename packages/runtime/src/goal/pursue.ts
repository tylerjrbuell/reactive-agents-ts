import type { GoalState, GoalVerdict } from "@reactive-agents/core";
import { evaluateGoal } from "./evaluate.js";
import type { GoalCheckOutcome, GoalEvaluation, GoalSegmentResult } from "./types.js";

/** Inputs for {@link pursueGoal}. Generic over the segment runner so Cortex and tests share it. */
export interface PursueGoalOptions {
  /** Runs one segment (an ordinary chat turn). Index is 0-based. */
  readonly runSegment: (state: GoalState, index: number) => Promise<GoalSegmentResult>;
  /**
   * Tier-2 rubric checker. Omit when no model is allowed; rubric criteria then stay undecided (`null`).
   * Return a {@link GoalCheckOutcome} to have the checker's own cost/tokens/duration counted in `spent`.
   */
  readonly check?: (state: GoalState, result: GoalSegmentResult) => Promise<GoalVerdict | GoalCheckOutcome | null>;
  readonly state: GoalState;
  /** Called after every transition (including the final one). */
  readonly onUpdate?: (evaluation: GoalEvaluation) => void;
  /** Polled between segments only. */
  readonly isCancelled?: () => boolean;
  readonly stallAfter?: number;
}

/** Final outcome of a pursuit. */
export interface PursueGoalResult {
  readonly state: GoalState;
  /** `true` achieved, `false` not achieved, `null` undecided. */
  readonly goalAchieved: boolean | null;
  readonly reason: string;
}

function errorMessage(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

/**
 * Run segments until the goal reaches a terminal status. Cancel is honored
 * between segments, never mid-segment. A throwing `runSegment` ends the goal
 * as `blocked` with the error message as reason.
 */
export async function pursueGoal(opts: PursueGoalOptions): Promise<PursueGoalResult> {
  let state: GoalState = opts.state.status === "active" ? opts.state : { ...opts.state, status: "active" };
  let goalAchieved: boolean | null = null;
  let reason = "not started";

  while (state.status === "active") {
    if (opts.isCancelled?.() === true) {
      state = { ...state, status: "cancelled" };
      reason = "cancelled between segments";
      opts.onUpdate?.({ state, verdict: null, goalAchieved, reason });
      break;
    }
    let result: GoalSegmentResult;
    try {
      result = await opts.runSegment(state, state.segments);
    } catch (e) {
      state = { ...state, status: "blocked" };
      reason = `segment failed: ${errorMessage(e)}`;
      goalAchieved = false;
      opts.onUpdate?.({ state, verdict: "blocked", goalAchieved, reason });
      break;
    }
    const needsRubric = state.criteria.some((c) => c.check.kind === "rubric");
    let rubricVerdict: GoalVerdict | null = null;
    let counted: GoalSegmentResult = result;
    if (needsRubric && opts.check) {
      try {
        const out = await opts.check(state, result);
        if (typeof out === "object" && out !== null) {
          rubricVerdict = out.verdict;
          counted = {
            ...result,
            costUsd: (result.costUsd ?? 0) + (out.costUsd ?? 0),
            tokens: (result.tokens ?? 0) + (out.tokens ?? 0),
            durationMs: (result.durationMs ?? 0) + (out.durationMs ?? 0),
          };
        } else {
          rubricVerdict = out;
        }
      } catch {
        rubricVerdict = null; // checker failure is undecided, not a guess
      }
    }
    const ev = evaluateGoal(state, counted, { stallAfter: opts.stallAfter, rubricVerdict });
    state = ev.state;
    goalAchieved = ev.goalAchieved;
    reason = ev.reason;
    opts.onUpdate?.(ev);
  }
  return { state, goalAchieved: state.status === "achieved" ? true : goalAchieved, reason };
}
