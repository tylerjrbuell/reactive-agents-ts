import { Data } from "effect";
import type { LLMProvider } from "./types.js";
import type { LLMErrorClass } from "./error-class.js";

/**
 * Structural classification fields shared by every provider error.
 * Stable contract for harness consumers (read structurally, never branch the
 * runtime on them): `errorClass` (closed set, see `error-class.ts`),
 * `retryable` (deterministic from class), `status` (HTTP status when known).
 * All optional: absent on errors constructed outside `mapProviderError`.
 */
export interface LLMErrorClassification {
  readonly errorClass?: LLMErrorClass;
  readonly retryable?: boolean;
  readonly status?: number;
}

/**
 * General LLM error — catch-all for unexpected provider failures.
 */
export class LLMError extends Data.TaggedError("LLMError")<{
  readonly message: string;
  readonly provider: LLMProvider;
  readonly cause?: unknown;
} & LLMErrorClassification> {}

/**
 * Rate limit exceeded — includes retry-after hint.
 */
export class LLMRateLimitError extends Data.TaggedError("LLMRateLimitError")<{
  readonly message: string;
  readonly provider: LLMProvider;
  readonly retryAfterMs: number;
} & LLMErrorClassification> {}

/**
 * Request timeout.
 *
 * `model` and `elapsedMs` are optional enrichment: local (Ollama) runs can
 * breach the ceiling under cold-load / GPU contention, and surfacing which
 * model timed out plus how long it actually ran turns a bare "timed out" into
 * an actionable line (see providers/local.ts timeout resolution).
 */
export class LLMTimeoutError extends Data.TaggedError("LLMTimeoutError")<{
  readonly message: string;
  readonly provider: LLMProvider;
  readonly timeoutMs: number;
  /** Model that timed out (when known). */
  readonly model?: string;
  /** Wall-clock ms actually elapsed before the client abandoned the call. */
  readonly elapsedMs?: number;
}> {
  /** Always `"timeout"` (structural classification, see error-class.ts). */
  readonly errorClass = "timeout" as const;
  /** A timeout is transient: the identical request may succeed. */
  readonly retryable = true;
}

/**
 * One attempt's parse failure inside the structured-output retry loop.
 * Carried by {@link LLMParseError.attempts}.
 */
export interface ParseAttemptError {
  readonly attempt: number;
  readonly error: unknown;
}

/**
 * Structured output parse failure. `rawOutput` is the final attempt's error
 * stringified (back-compat); `attempts` carries every attempt's error in order
 * so the original parse failure is recoverable when retries mask later ones.
 */
export class LLMParseError extends Data.TaggedError("LLMParseError")<{
  readonly message: string;
  readonly rawOutput: string;
  readonly expectedSchema: string;
  readonly attempts?: ReadonlyArray<ParseAttemptError>;
}> {}

/**
 * Context window overflow — too many tokens for the model.
 */
export class LLMContextOverflowError extends Data.TaggedError(
  "LLMContextOverflowError",
)<{
  readonly message: string;
  readonly tokenCount: number;
  /** 0 when the provider did not state it. */
  readonly maxTokens: number;
  /** `context_overflow` (prompt exceeds window) or `request_too_large` (413 / byte limit). */
  readonly errorClass?: "context_overflow" | "request_too_large";
  /** Always false: re-sending the identical request cannot succeed. */
  readonly retryable?: boolean;
  readonly status?: number;
}> {}

/**
 * Live model discovery failed (see `model-discovery.ts`). Deliberately NOT part
 * of {@link LLMErrors}: it is raised by catalog listing, never by a completion.
 * `message` never contains credentials.
 */
export class ModelDiscoveryError extends Data.TaggedError("ModelDiscoveryError")<{
  readonly provider: string;
  /** no-credentials: key missing, nothing sent. unreachable: network/timeout. http: non-2xx. parse: unexpected body. */
  readonly reason: "no-credentials" | "unreachable" | "http" | "parse";
  readonly status?: number;
  readonly message: string;
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
