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
 * Task execution failure.
 */
export class TaskError extends Data.TaggedError("TaskError")<{
  readonly taskId: string;
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
