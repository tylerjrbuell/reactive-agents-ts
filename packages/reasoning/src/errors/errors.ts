// File: src/errors/errors.ts
import { Data } from "effect";

// ─── Base reasoning error ───
export class ReasoningError extends Data.TaggedError("ReasoningError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Strategy not found in registry ───
export class StrategyNotFoundError extends Data.TaggedError(
  "StrategyNotFoundError",
)<{
  readonly strategy: string;
}> {}

// ─── Strategy selection failed ───
export class SelectionError extends Data.TaggedError("SelectionError")<{
  readonly message: string;
  readonly context?: unknown;
}> {}

// ─── Strategy execution failed ───
export class ExecutionError extends Data.TaggedError("ExecutionError")<{
  readonly strategy: string;
  readonly message: string;
  readonly step?: number;
  readonly cause?: unknown;
}> {}

// ─── Max iterations / depth exceeded ───
export class IterationLimitError extends Data.TaggedError(
  "IterationLimitError",
)<{
  readonly strategy: string;
  readonly limit: number;
  readonly stepsCompleted: number;
}> {}

// ─── Union type for service signatures ───
export type ReasoningErrors =
  | ReasoningError
  | StrategyNotFoundError
  | SelectionError
  | ExecutionError
  | IterationLimitError;
