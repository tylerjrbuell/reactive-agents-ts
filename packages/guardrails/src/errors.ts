import { Data } from "effect";

export class GuardrailError extends Data.TaggedError("GuardrailError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ViolationError extends Data.TaggedError("ViolationError")<{
  readonly message: string;
  readonly violationType: string;
  readonly severity: string;
}> {}
