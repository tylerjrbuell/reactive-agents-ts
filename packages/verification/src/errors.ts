import { Data } from "effect";

export class VerificationError extends Data.TaggedError("VerificationError")<{
  readonly message: string;
  readonly layer?: string;
  readonly cause?: unknown;
}> {}

export class CalibrationError extends Data.TaggedError("CalibrationError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
