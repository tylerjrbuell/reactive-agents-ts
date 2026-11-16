import { Data } from "effect";

/**
 * Rejection of `agent.plan()` when the plan run ended with no steps: the model
 * recorded no `todo` list and its reply held nothing the harness could read as
 * a step. The plan is never silently empty: callers get this typed failure.
 */
export class PlanNoStepsError extends Data.TaggedError("PlanNoStepsError")<{
  /** The goal the plan run was asked to plan. */
  readonly goal: string;
  /** The reply the plan run produced (what the harness found no steps in). */
  readonly reply: string;
}> {
  override get message(): string {
    return "The plan run produced no steps: the model recorded no todo list and its reply held no numbered or bulleted step lines.";
  }
}
