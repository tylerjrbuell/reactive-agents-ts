import { Data } from "effect";

export class ToolNotFoundError extends Data.TaggedError("ToolNotFoundError")<{
  readonly message: string;
  readonly toolName: string;
  readonly availableTools?: readonly string[];
}> {}

export class ToolExecutionError extends Data.TaggedError(
  "ToolExecutionError",
)<{
  readonly message: string;
  readonly toolName: string;
  readonly input?: unknown;
  readonly cause?: unknown;
}> {}

/**
 * Raised by `defineTool` when the options object is malformed — e.g. the
 * caller passed intuitive-but-wrong field names (`parameters`/`execute`)
 * instead of the canonical `input`/`handler`. This replaces the raw
 * `TypeError: undefined is not an object (evaluating 'schema.ast')` crash
 * with a typed, actionable error that names the correct fields.
 */
export class ToolDefinitionError extends Data.TaggedError(
  "ToolDefinitionError",
)<{
  readonly message: string;
  /** Tool name if it could be read from the options; otherwise "<unknown>". */
  readonly toolName: string;
  /** The option key that was wrong or missing (e.g. "input", "handler"). */
  readonly field: string;
}> {}

export class ToolTimeoutError extends Data.TaggedError("ToolTimeoutError")<{
  readonly message: string;
  readonly toolName: string;
  readonly timeoutMs: number;
}> {}

export class ToolValidationError extends Data.TaggedError(
  "ToolValidationError",
)<{
  readonly message: string;
  readonly toolName: string;
  readonly parameter: string;
  readonly expected: string;
  readonly received: string;
}> {}

export class MCPConnectionError extends Data.TaggedError(
  "MCPConnectionError",
)<{
  readonly message: string;
  readonly serverName: string;
  readonly transport: string;
  readonly cause?: unknown;
}> {}

export class ToolAuthorizationError extends Data.TaggedError(
  "ToolAuthorizationError",
)<{
  readonly message: string;
  readonly toolName: string;
  readonly agentId: string;
}> {}
