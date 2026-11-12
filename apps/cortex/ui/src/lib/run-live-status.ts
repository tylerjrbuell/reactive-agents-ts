/**
 * A run list row's status after a live event, mirroring the server's
 * `deriveRunStats` / `updateRunStats` rules: `AgentCompleted` sets completed or
 * failed, `TaskFailed` sets failed, `ExecutionCancelled` (a chat turn stopped or
 * left mid-run), `AgentStopped` (desk Stop) and `AgentTerminated` (desk
 * Terminate) set stopped, `AgentAborted` (the run's effect failed without an
 * `AgentCompleted`) sets failed, stopped when its `reason` is a user stop or
 * terminate, or blocked when a guardrail ended it (`abortStatusOf`), and a
 * stopped or blocked run that then reports a failure keeps its status. `undefined` when the
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
  const settled = next === "failed" && (status === "stopped" || status === "blocked") ? status : next;
  return settled === status ? undefined : settled;
}

/**
 * The status an `AgentAborted` leaves: `stopped` when the runtime says a user
 * stop or terminate ended it (`reason`), `blocked` when a guardrail did
 * (`reason: "guardrail"`), else `failed`. The server's `deriveRunStats` and the
 * run view's `deriveStatus` use the same rule.
 */
export function abortStatusOf(payload: Readonly<Record<string, unknown>>): "stopped" | "blocked" | "failed" {
  if (payload.reason === "user-stop" || payload.reason === "terminate") return "stopped";
  return payload.reason === "guardrail" ? "blocked" : "failed";
}
