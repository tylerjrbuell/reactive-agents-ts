// packages/health/src/errors.ts
import { Data } from "effect";

export class HealthServerError extends Data.TaggedError("HealthServerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
