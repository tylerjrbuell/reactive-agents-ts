// packages/replay/src/errors.ts
import { Data } from "effect";

/**
 * Raised by `loadRecordedRun` when a recorded run cannot be loaded: the
 * id/path does not resolve to a trace file, or the trace has no
 * `run-started` event.
 *
 * `message` keeps the previous `replay: ...` text byte-identical so
 * message-based consumers (and the diagnose CLI's `.message` renderer) stay
 * green; `_tag` gives callers a stable discriminator.
 */
export class ReplayLoadError extends Data.TaggedError("ReplayLoadError")<{
  readonly message: string;
}> {}
