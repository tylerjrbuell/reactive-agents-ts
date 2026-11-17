/**
 * How a finished run ended, read from its `AgentCompleted` payload by ui-core's
 * one classifier (`turnOutcomeOf`): `succeeded`, `failed`, `partial`,
 * `abstained`, ... Stored on `cortex_runs.ending` so run lists can tell an
 * abstention (a deliberate decline) from a failure: both report `success: false`
 * and share the `failed` status. A run the user stopped is the exception: it
 * reports `success: false` too, but its status is `stopped`, not `failed`.
 */
import { isUserStopResult, turnOutcomeOf, type TurnEnding } from "@reactive-agents/ui-core";

/** The ending of a run from its `AgentCompleted` payload. */
export function runEndingOf(agentCompleted: Readonly<Record<string, unknown>>): TurnEnding {
  return turnOutcomeOf(agentCompleted).ending;
}

/**
 * The run status an `AgentCompleted` payload sets: `completed`, `stopped` when
 * the user stopped or paused the run (an honest partial, never a failure), else
 * `failed`. Only an explicit `success: false` is a failure (some paths omit the flag).
 */
export function completedStatusOf(agentCompleted: Readonly<Record<string, unknown>>): "completed" | "failed" | "stopped" {
  if (agentCompleted["success"] !== false) return "completed";
  return isUserStopResult(agentCompleted) ? "stopped" : "failed";
}
