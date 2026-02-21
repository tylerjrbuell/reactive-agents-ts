import { Data } from "effect";

export class EvalError extends Data.TaggedError("EvalError")<{
  readonly message: string;
  readonly caseId?: string;
  readonly cause?: unknown;
}> {}

export class BenchmarkError extends Data.TaggedError("BenchmarkError")<{
  readonly message: string;
  readonly suiteId: string;
}> {}

export class DatasetError extends Data.TaggedError("DatasetError")<{
  readonly message: string;
  readonly path?: string;
  readonly cause?: unknown;
}> {}

export type EvalErrors = EvalError | BenchmarkError | DatasetError;
