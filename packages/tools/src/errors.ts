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
 * Combinator for building a catch-handler that converts an unknown thrown
 * value into a `ToolExecutionError` with a correctly-formatted message.
 *
 * Guards against the "Error: Error: ENOENT..." double-prefix that results
 * from naively interpolating an `Error` object (`${e}` calls `.toString()`,
 * which already includes the "Error: " prefix) — this extracts `.message`
 * instead, falling back to `String(e)` for non-Error throws.
 *
 * Usage: `catch: toToolError("file-write", "File write failed")`
 */
export const toToolError =
  (toolName: string, label: string) =>
  (e: unknown): ToolExecutionError =>
    new ToolExecutionError({
      message: `${label} failed: ${e instanceof Error ? e.message : String(e)}`,
      toolName,
      cause: e,
    });

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

/**
 * Raised by `defineTool` when a handler's resolved return value fails to
 * decode against the tool's declared `output` schema. Only fires when the
 * tool author opted in via `output: ToolSchema<O>` — tools without one keep
 * today's unvalidated-return behavior.
 */
export class ToolOutputValidationError extends Data.TaggedError(
  "ToolOutputValidationError",
)<{
  readonly message: string;
  readonly toolName: string;
  readonly rawOutput?: unknown;
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
