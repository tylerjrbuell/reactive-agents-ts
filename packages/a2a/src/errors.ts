/**
 * A2A Protocol Errors — using Effect-TS tagged errors following Reactive Agents conventions.
 */
import { Data, Schema } from "effect";

export class A2AError extends Data.TaggedError("A2AError")<{
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}> {
  static codeSchema = Schema.Literal(
    "PARSE_ERROR",
    "INVALID_REQUEST",
    "METHOD_NOT_FOUND",
    "INVALID_PARAMS",
    "INTERNAL_ERROR",
    "TASK_NOT_FOUND",
    "TASK_CANCELED",
    "INVALID_TASK_STATE",
    "TRANSPORT_ERROR",
    "AUTHENTICATION_FAILED",
    "AGENT_NOT_FOUND",
  );

  static parse(error: unknown): A2AError {
    if (error instanceof A2AError) return error;
    return new A2AError({
      code: "INTERNAL_ERROR",
      message: String(error),
    });
  }
}

export class DiscoveryError extends Data.TaggedError("DiscoveryError")<{
  readonly message: string;
  readonly url?: string;
}> {}

export class TransportError extends Data.TaggedError("TransportError")<{
  readonly message: string;
  readonly statusCode?: number;
  readonly url?: string;
}> {}

export class TaskNotFoundError extends Data.TaggedError("TaskNotFoundError")<{
  readonly taskId: string;
}> {}

export class TaskCanceledError extends Data.TaggedError("TaskCanceledError")<{
  readonly taskId: string;
  readonly reason?: string;
}> {}

export class InvalidTaskStateError extends Data.TaggedError("InvalidTaskStateError")<{
  readonly taskId: string;
  readonly currentState: string;
  readonly attemptedTransition: string;
}> {}

export class AuthenticationError extends Data.TaggedError("AuthenticationError")<{
  readonly message: string;
  readonly scheme?: string;
}> {}
