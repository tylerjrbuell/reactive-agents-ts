// packages/diagnose/src/errors.ts
import { Data } from "effect";

/**
 * Raised by the `rax-diagnose` CLI and its commands when required arguments
 * are missing or empty (e.g. `replay` without a runId, `grep` without an
 * expression).
 *
 * `message` is the exact user-facing usage text; `cli.ts` renders it via
 * `.message`, and `_tag` gives a stable discriminator without `instanceof`.
 */
export class DiagnoseUsageError extends Data.TaggedError("DiagnoseUsageError")<{
  readonly message: string;
}> {}

/**
 * Raised by `grepCommand` when the user-supplied JS predicate expression does
 * not compile. `message` keeps the `Invalid grep expression: ...` text;
 * `cause` keeps the original SyntaxError.
 */
export class GrepExpressionError extends Data.TaggedError("GrepExpressionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Raised by `resolveTracePath` when a trace file, runId, or the `latest`
 * alias cannot be resolved against the candidate trace directories.
 * `message` carries the exact resolution text, including did-you-mean hints.
 */
export class TraceNotFoundError extends Data.TaggedError("TraceNotFoundError")<{
  readonly message: string;
}> {}
