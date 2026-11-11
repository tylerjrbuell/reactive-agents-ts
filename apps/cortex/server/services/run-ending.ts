/**
 * How a finished run ended, read from its `AgentCompleted` payload by ui-core's
 * one classifier (`turnOutcomeOf`): `succeeded`, `failed`, `partial`,
 * `abstained`, ... Stored on `cortex_runs.ending` so run lists can tell an
 * abstention (a deliberate decline) from a failure: both report `success: false`
 * and share the `failed` status.
 */
import { turnOutcomeOf, type TurnEnding } from "@reactive-agents/ui-core";

/** The ending of a run from its `AgentCompleted` payload. */
export function runEndingOf(agentCompleted: Readonly<Record<string, unknown>>): TurnEnding {
  return turnOutcomeOf(agentCompleted).ending;
}
