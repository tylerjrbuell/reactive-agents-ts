import { Data } from "effect";
import type { LLMProvider } from "./types.js";

/**
 * General LLM error — catch-all for unexpected provider failures.
 */
export class LLMError extends Data.TaggedError("LLMError")<{
  readonly message: string;
  readonly provider: LLMProvider;
  readonly cause?: unknown;
}> {}

/**
 * Rate limit exceeded — includes retry-after hint.
 */
export class LLMRateLimitError extends Data.TaggedError("LLMRateLimitError")<{
  readonly message: string;
  readonly provider: LLMProvider;
  readonly retryAfterMs: number;
}> {}

/**
 * Request timeout.
 */
export class LLMTimeoutError extends Data.TaggedError("LLMTimeoutError")<{
  readonly message: string;
  readonly provider: LLMProvider;
  readonly timeoutMs: number;
}> {}

/**
 * Structured output parse failure.
 */
export class LLMParseError extends Data.TaggedError("LLMParseError")<{
  readonly message: string;
  readonly rawOutput: string;
  readonly expectedSchema: string;
}> {}

/**
 * Context window overflow — too many tokens for the model.
 */
export class LLMContextOverflowError extends Data.TaggedError(
  "LLMContextOverflowError",
)<{
  readonly message: string;
  readonly tokenCount: number;
  readonly maxTokens: number;
}> {}

/**
 * Union of all LLM error types.
 */
export type LLMErrors =
  | LLMError
  | LLMRateLimitError
  | LLMTimeoutError
  | LLMParseError
  | LLMContextOverflowError;
