import type { GoalState, GoalVerdict } from "@reactive-agents/core";

/** What one segment (an ordinary chat turn) reports back to the supervisor. */
export interface GoalSegmentResult {
  /** Final text of the segment. Tier-1 checks run against this. */
  readonly output: string;
  /** Deliverable ids/paths from the receipt; matched by `must-include` too. */
  readonly deliverables?: readonly string[];
  /**
   * Legacy caller-computed progress flag. Ignored when `run.evidenceDelta` is
   * present (the kernel's progress currency wins). Absent with no
   * `run.evidenceDelta` means no progress claim, so the segment counts as no-delta.
   */
  readonly progressed?: boolean;
  /**
   * What the run that served this segment concluded, in the kernel's own
   * vocabulary. Build it with {@link goalRunOf}. When present, the supervisor
   * never calls a goal achieved that the run's exit gate denied.
   */
  readonly run?: GoalRunOutcome;
  readonly costUsd?: number;
  readonly tokens?: number;
  /** Wall-clock duration of the segment in ms. */
  readonly durationMs?: number;
}

/**
 * The run-level done/progress verdict one segment's run reached. One
 * vocabulary with the kernel: the supervisor keeps no done/progress heuristics
 * of its own.
 */
export interface GoalRunOutcome {
  /**
   * `AgentResult.goalAchieved`: the exit-gate outcome (terminatedBy folded with
   * RunContract deliverable evidence). `false` = the run's gate denied completion.
   */
  readonly goalAchieved: boolean | null;
  /** RunContract requirement ids still outstanding at the terminal (`metadata.outstandingCriteria`). */
  readonly outstanding?: readonly string[];
  /**
   * Sum of `RunAssessment.evidenceDelta` over the segment (the `AssessmentEmitted`
   * events of its run). Meta-tool-only work adds none. `0` = no new evidence.
   */
  readonly evidenceDelta?: number;
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

/**
 * Rich result of a tier-2 check. Lets a checker report its own spend so the
 * supervisor counts it in `GoalState.spent` (a checker is a model call too).
 * A checker may still return a bare `GoalVerdict | null`, which adds no spend.
 */
export interface GoalCheckOutcome {
  /** Verdict, `null` when undecided. */
  readonly verdict: GoalVerdict | null;
  readonly costUsd?: number;
  readonly tokens?: number;
  readonly durationMs?: number;
}
