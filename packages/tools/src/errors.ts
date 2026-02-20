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
