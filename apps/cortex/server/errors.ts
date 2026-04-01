import { Data } from "effect";

export class CortexError extends Data.TaggedError("CortexError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CortexNotFoundError extends Data.TaggedError("CortexNotFoundError")<{
  readonly id: string;
  readonly resource: string;
}> {}

export type CortexErrors = CortexError | CortexNotFoundError;
