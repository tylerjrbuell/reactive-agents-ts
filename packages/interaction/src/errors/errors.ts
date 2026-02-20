import { Data } from "effect";

// ─── Base interaction error ───
export class InteractionError extends Data.TaggedError("InteractionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Invalid mode transition ───
export class ModeError extends Data.TaggedError("ModeError")<{
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}> {}

// ─── Checkpoint operation failed ───
export class CheckpointError extends Data.TaggedError("CheckpointError")<{
  readonly checkpointId: string;
  readonly message: string;
}> {}

// ─── No active session ───
export class SessionNotFoundError extends Data.TaggedError("SessionNotFoundError")<{
  readonly sessionId: string;
}> {}

// ─── Notification delivery failed ───
export class NotificationError extends Data.TaggedError("NotificationError")<{
  readonly channel: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── User input timeout ───
export class InputTimeoutError extends Data.TaggedError("InputTimeoutError")<{
  readonly timeoutMs: number;
  readonly message: string;
}> {}

// ─── Union type ───
export type InteractionErrors =
  | InteractionError
  | ModeError
  | CheckpointError
  | SessionNotFoundError
  | NotificationError
  | InputTimeoutError;
