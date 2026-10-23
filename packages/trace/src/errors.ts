// packages/trace/src/errors.ts
import { Data } from "effect";

/**
 * Raised by `validateRationale` when a candidate Rationale fails a shape rule.
 *
 * Thrown (not an Effect error channel) to keep the validator's existing sync
 * calling contract — `isRationale` and the test suite catch it as a plain
 * throw site, mirroring the sanctioned validator pattern in
 * `@reactive-agents/memory` (`throw new MemoryError({ message })`).
 * `message` carries the exact, byte-identical validator text (prefixed
 * `Rationale: `) so message-based consumers stay green; `_tag` gives
 * consumers a stable discriminator without relying on `instanceof`.
 */
export class RationaleValidationError extends Data.TaggedError("RationaleValidationError")<{
  readonly message: string;
}> {}

/**
 * Raised inside the trace recorder when a disk-store operation fails
 * (retention prune, directory creation, JSONL append).
 *
 * The value never escapes the recorder: each construction site is a
 * `Effect.tryPromise` catch whose failure is immediately consumed by
 * `errorTag(err)` in an `Effect.catchAll` that publishes an
 * `ErrorSwallowed` telemetry event. `errorTag` resolves tagged errors via
 * their `_tag` (the class-name identity fallback is never reached), so the
 * emitted discriminator is now `"TraceStorageError"` instead of `"Error"`.
 * `cause` keeps the original IO error for debugging; `message` keeps the
 * previous `String(e)` rendering byte-identical.
 */
export class TraceStorageError extends Data.TaggedError("TraceStorageError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
