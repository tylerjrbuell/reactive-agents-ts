/**
 * Goal types: a goal is a supervisor over ordinary chat turns ("segments").
 * Additive only. `GoalCriterion` maps onto the `SuccessCriterion` vocabulary
 * (regex / llm-judge) so there is one oracle vocabulary.
 */

/** How one goal criterion is checked. `rubric` needs a model; the others are deterministic. */
export type GoalCriterionCheck =
  | { readonly kind: "regex"; readonly pattern: string }
  | { readonly kind: "must-include"; readonly value: string }
  | { readonly kind: "rubric" };

/** One completion criterion of a goal. */
export interface GoalCriterion {
  readonly id: string;
  readonly text: string;
  readonly check: GoalCriterionCheck;
}

/** Budget for a goal, checked at segment boundaries only. */
export interface GoalBudget {
  readonly maxSegments: number;
  readonly maxCostUsd?: number;
  readonly maxTokens?: number;
  readonly maxWallClockMs?: number;
}

/** Checker verdict for a segment. An undecided verdict is `null`, never a guess. */
export type GoalVerdict = "achieved" | "progressing" | "stalled" | "blocked";

/** Lifecycle status of a goal. */
export type GoalStatus =
  | "proposed"
  | "active"
  | "paused"
  | "achieved"
  | "stalled"
  | "blocked"
  | "budget-exhausted"
  | "cancelled";

/** Cumulative spend of a goal. */
export interface GoalSpent {
  readonly costUsd: number;
  readonly tokens: number;
  readonly wallClockMs: number;
}

/** Full goal state. Immutable: the supervisor returns new values. */
export interface GoalState {
  readonly id: string;
  readonly objective: string;
  readonly criteria: readonly GoalCriterion[];
  readonly budget: GoalBudget;
  readonly status: GoalStatus;
  /** Number of segments run so far. */
  readonly segments: number;
  readonly spent: GoalSpent;
  /** Per-segment verdicts; `null` where the checker could not decide. */
  readonly verdictHistory: readonly (GoalVerdict | null)[];
  /** Consecutive segments with no new evidence and no requirement transition. */
  readonly noDeltaStreak: number;
}
