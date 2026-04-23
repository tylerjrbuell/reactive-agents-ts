import { Data } from "effect";

/**
 * Base agent error — catch-all for unexpected agent failures.
 */
export class AgentError extends Data.TaggedError("AgentError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Agent not found in registry.
 */
export class AgentNotFoundError extends Data.TaggedError("AgentNotFoundError")<{
  readonly agentId: string;
  readonly message: string;
}> {}

/**
 * Task-kind failure — the task itself is ill-formed, unsolvable as stated,
 * or the agent's output cannot satisfy it. Retryable only by CHANGING the
 * task (not by re-running unchanged). Umbrella for `VerificationFailed`
 * and other task-kind subtypes in the framework error taxonomy.
 *
 * `taskId` is optional because some task-kind failures don't originate in
 * a specific `TaskId` (e.g. an ill-formed input detected at the builder
 * level before a task is assigned an id).
 *
 * @see isRetryable — returns false for TaskError and subtypes
 * @see VerificationFailed — task-kind subtype for failed verification
 */
export class TaskError extends Data.TaggedError("TaskError")<{
  readonly taskId?: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Schema validation failure.
 */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly message: string;
  readonly value?: unknown;
}> {}

/**
 * Runtime failure (fiber crash, timeout, etc.).
 */
export class RuntimeError extends Data.TaggedError("RuntimeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
