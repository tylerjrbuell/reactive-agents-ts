import { Data } from "effect";

/**
 * Rejection of `agent.execute(plan)` / `agent.run(input, { plan })` when the
 * supplied plan cannot run: it does not decode as a `Plan`, or its `dependsOn`
 * graph names an unknown step, a step itself, or forms a cycle. Raised at the
 * boundary, before any run starts, so a bad edit never half-runs.
 */
export class PlanInvalidError extends Data.TaggedError("PlanInvalidError")<{
  /** What is wrong with the plan, in words a user can act on. */
  readonly reason: string;
}> {
  override get message(): string {
    return `The plan cannot run: ${this.reason}`;
  }
}
