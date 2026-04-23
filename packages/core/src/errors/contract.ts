import { Data } from "effect";

/**
 * Contract failure — OUR code is wrong (type mismatch, schema violation,
 * misuse of an API, invariant broken). NOT retryable. Indicates a bug
 * that must be fixed, not handled.
 *
 * @see isRetryable — returns false
 */
export class ContractError extends Data.TaggedError("ContractError")<{
  readonly message: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
}> {}

/**
 * A tool declared `idempotent: false` was attempted for retry on timeout.
 * This is a framework bug — retry rules MUST filter on idempotency before
 * emitting a retry decision. Seeing this in production means the retry
 * rule pipeline regressed.
 */
export class ToolIdempotencyViolation extends Data.TaggedError("ToolIdempotencyViolation")<{
  readonly toolName: string;
  readonly message: string;
}> {}
