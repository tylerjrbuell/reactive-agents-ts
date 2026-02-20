import { Data } from "effect";

export class ExecutionError extends Data.TaggedError("ExecutionError")<{
  readonly message: string;
  readonly taskId: string;
  readonly phase: string;
  readonly cause?: unknown;
}> {}

export class HookError extends Data.TaggedError("HookError")<{
  readonly message: string;
  readonly phase: string;
  readonly timing: string;
  readonly cause?: unknown;
}> {}

export class MaxIterationsError extends Data.TaggedError("MaxIterationsError")<{
  readonly message: string;
  readonly taskId: string;
  readonly iterations: number;
  readonly maxIterations: number;
}> {}

export class GuardrailViolationError extends Data.TaggedError(
  "GuardrailViolationError",
)<{
  readonly message: string;
  readonly taskId: string;
  readonly violation: string;
}> {}

export type RuntimeErrors =
  | ExecutionError
  | HookError
  | MaxIterationsError
  | GuardrailViolationError;
