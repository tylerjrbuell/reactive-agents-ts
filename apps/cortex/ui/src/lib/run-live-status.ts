/**
 * A run list row's status after a live event, mirroring the server's
 * `deriveRunStats` / `updateRunStats` rules: `AgentCompleted` sets completed or
 * failed, `TaskFailed` sets failed, `ExecutionCancelled` (a chat turn stopped or
 * left mid-run), `AgentStopped` (desk Stop) and `AgentTerminated` (desk
 * Terminate) set stopped, `AgentAborted` (the run's effect failed without an
 * `AgentCompleted`, e.g. an output guardrail block) sets failed, or stopped
 * when its `reason` is a user stop or terminate (`abortStatusOf`), and a
 * stopped run that then reports a failure stays stopped. `undefined` when the
 * event does not change the status. Pure.
 */
export function runStatusAfter(
  status: string,
  type: string,
  payload: Readonly<Record<string, unknown>>,
): string | undefined {
  const next =
    type === "AgentCompleted"
      ? payload.success === false
        ? "failed"
        : "completed"
      : type === "TaskFailed"
        ? "failed"
        : type === "AgentAborted"
          ? abortStatusOf(payload)
          : type === "ExecutionCancelled" || type === "AgentStopped" || type === "AgentTerminated"
            ? "stopped"
            : undefined;
  if (next === undefined) return undefined;
  const settled = next === "failed" && status === "stopped" ? "stopped" : next;
  return settled === status ? undefined : settled;
}

/**
 * The status an `AgentAborted` leaves: `stopped` when the runtime says a user
 * stop or terminate ended it (`reason`), else `failed`. The server's
 * `deriveRunStats` and the run view's `deriveStatus` use the same rule.
 */
export function abortStatusOf(payload: Readonly<Record<string, unknown>>): "stopped" | "failed" {
  return payload.reason === "user-stop" || payload.reason === "terminate" ? "stopped" : "failed";
}
