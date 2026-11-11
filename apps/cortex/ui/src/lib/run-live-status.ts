/**
 * A run list row's status after a live event, mirroring the server's
 * `deriveRunStats` / `updateRunStats` rules: `AgentCompleted` sets completed or
 * failed, `TaskFailed` sets failed, `ExecutionCancelled` (a chat turn stopped or
 * left mid-run), `AgentStopped` (desk Stop) and `AgentTerminated` (desk
 * Terminate) set stopped, and a stopped run that then
 * reports a failure stays stopped. `undefined` when the event does not change
 * the status. Pure.
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
        : type === "ExecutionCancelled" || type === "AgentStopped" || type === "AgentTerminated"
          ? "stopped"
          : undefined;
  if (next === undefined) return undefined;
  const settled = next === "failed" && status === "stopped" ? "stopped" : next;
  return settled === status ? undefined : settled;
}
