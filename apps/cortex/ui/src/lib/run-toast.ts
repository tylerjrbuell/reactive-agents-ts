import { runErrorLine } from "./run-error.js";

/** The toast a run's end deserves. */
export type RunEndToast = {
  readonly kind: "success" | "error";
  readonly title: string;
  /** The run's cause (first line, redacted) on a failure. */
  readonly message?: string;
  readonly href: string;
  /** One toast per run: a second end event for the same run replaces the first. */
  readonly key: string;
};

/**
 * Toast for a live `AgentCompleted` / `TaskFailed` message, or `null` for any other
 * type. A failed run's toast carries the run's error (e.g. the provider's message), so
 * "<name> failed" is never the whole story. Both end events of one run share a key.
 */
export function runEndToast(msg: {
  readonly type: string;
  readonly runId: string;
  readonly name: string;
  readonly payload: Readonly<Record<string, unknown>>;
}): RunEndToast | null {
  const href = `/run/${msg.runId}`;
  const key = `run-end:${msg.runId}`;
  const message = runErrorLine(msg.payload.error);
  if (msg.type === "AgentCompleted") {
    if (msg.payload.success !== false) return { kind: "success", title: `${msg.name} completed`, href, key };
    return { kind: "error", title: `${msg.name} failed`, ...(message ? { message } : {}), href, key };
  }
  if (msg.type === "TaskFailed") {
    return { kind: "error", title: `${msg.name} failed`, ...(message ? { message } : {}), href, key };
  }
  return null;
}
