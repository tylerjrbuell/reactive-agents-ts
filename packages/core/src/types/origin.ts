/**
 * The caller that started a run. Stamped on `AgentStarted.origin` and the
 * `run-started` trace event so harness utility prompts (title generation, goal
 * judging) and subagent runs can be told apart from user tasks.
 *
 * - `"user"` (default; also the meaning of an absent origin) — a direct caller.
 * - `"gateway"` — a persistent-gateway turn (webhook, channel, heartbeat).
 * - `"cortex-chat"` — a Cortex chat turn.
 * - `"cortex-utility"` — a Cortex harness utility prompt (title, goal judge).
 * - `"subagent"` — a delegated child run (derived by the engine, not passed).
 * - `"scheduled"` — a cron/scheduled run.
 * - `"eval"` — an eval or benchmark harness.
 */
export type RunOrigin =
  | "user"
  | "gateway"
  | "cortex-chat"
  | "cortex-utility"
  | "subagent"
  | "scheduled"
  | "eval";

/** Every valid {@link RunOrigin}, for runtime validation of untyped carriers. */
export const RUN_ORIGINS: readonly RunOrigin[] = [
  "user",
  "gateway",
  "cortex-chat",
  "cortex-utility",
  "subagent",
  "scheduled",
  "eval",
];

/** Type guard: is `v` a known {@link RunOrigin}? */
export const isRunOrigin = (v: unknown): v is RunOrigin =>
  typeof v === "string" && (RUN_ORIGINS as readonly string[]).includes(v);

/**
 * Cause class of an abnormal run end (`AgentAborted.causeClass`).
 *
 * - `"failure"` — the run's effect failed with a typed error.
 * - `"defect"` — an unexpected exception/crash (untyped).
 * - `"interrupt"` — the run fiber was interrupted (terminate(), abort signal, timeout).
 */
export type RunAbortCause = "failure" | "defect" | "interrupt";

/**
 * Why the runtime knows a run ended abnormally (`AgentAborted.reason`), when it knows.
 *
 * - `"timeout"` — the per-execution timeout fired.
 * - `"user-stop"` — a graceful `stop()` was honored at a phase boundary.
 * - `"terminate"` — the kill switch / `terminate()` ended the run.
 * - `"abort"` — an external interrupt (abort signal, consumer cancel) with no other known cause.
 */
export type RunAbortReason = "timeout" | "user-stop" | "terminate" | "abort";
