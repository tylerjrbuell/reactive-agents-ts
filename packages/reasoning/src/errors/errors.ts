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

// ─── KernelState codec failure (kernel-codec.ts) ───
// Thrown (not Effect.fail'd) by serializeKernelState/deserializeKernelState:
// the codec is a pure synchronous function called from many non-Effect
// contexts (unit tests, iterate-pass.ts's plain try/catch checkpoint
// callbacks). A typed throw still lets `instanceof KernelCodecError` /
// `err.reason` discriminate without forcing every caller onto Effect.
export class KernelCodecError extends Data.TaggedError("KernelCodecError")<{
  readonly message: string;
  /** Discriminates the failure shape without parsing `message`. */
  readonly reason: "invalid-json" | "invalid-envelope" | "version-mismatch" | "invalid-state";
  readonly cause?: unknown;
}> {}

// ─── Tool transform expression parse/eval failure (tool-parsing.ts) ───
// Thrown by the safeEval walker inside evaluateTransform(); always caught
// there and folded into a "[Transform error: ...]" string, so this never
// escapes the module — the typed class only replaces plain `Error` for
// internal instanceof/tag discrimination and future callers.
export class ToolExpressionParseError extends Data.TaggedError(
  "ToolExpressionParseError",
)<{
  readonly message: string;
  readonly expression?: string;
}> {}

// ─── Union type for service signatures ───
export type ReasoningErrors =
  | ReasoningError
  | StrategyNotFoundError
  | SelectionError
  | ExecutionError
  | IterationLimitError
  | KernelCodecError
  | ToolExpressionParseError;
