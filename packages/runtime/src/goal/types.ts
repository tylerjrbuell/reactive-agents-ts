import type { GoalState, GoalVerdict } from "@reactive-agents/core";

/** What one segment (an ordinary chat turn) reports back to the supervisor. */
export interface GoalSegmentResult {
  /** Final text of the segment. Tier-1 checks run against this. */
  readonly output: string;
  /** Deliverable ids/paths from the receipt; matched by `must-include` too. */
  readonly deliverables?: readonly string[];
  /** True when the segment added ledger evidence or moved a requirement status. */
  readonly progressed: boolean;
  readonly costUsd?: number;
  readonly tokens?: number;
  /** Wall-clock duration of the segment in ms. */
  readonly durationMs?: number;
}

/** Outcome of evaluating one segment. */
export interface GoalEvaluation {
  readonly state: GoalState;
  /** Checker verdict, `null` when undecided. */
  readonly verdict: GoalVerdict | null;
  /** `true` achieved, `false` determinately not yet, `null` undecided. */
  readonly goalAchieved: boolean | null;
  /** Human-readable reason for the status transition. */
  readonly reason: string;
}

/** Options for {@link evaluateGoal}. */
export interface EvaluateGoalOptions {
  /** Consecutive no-delta segments that mean stalled. Default 2. */
  readonly stallAfter?: number;
  /** Tier-2 verdict for rubric criteria; omit when no model is allowed. */
  readonly rubricVerdict?: GoalVerdict | null;
}
