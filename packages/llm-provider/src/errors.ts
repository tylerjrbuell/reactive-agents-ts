import { Data } from "effect";
import type { LLMProvider } from "./types.js";
import type { LLMErrorClass } from "./error-class.js";
import type { StatedLimit } from "./capability-learned.js";

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
  /**
   * An output limit the provider stated in this error (e.g. "supports at most
   * 16384 completion tokens"), already written to the model's capability
   * (capability-learned.ts). Absent when none was stated.
   */
  readonly learnedLimit?: StatedLimit;
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
  /**
   * `context_overflow` (prompt exceeds window), `request_too_large` (413 / byte
   * limit) or `token_rate_exceeded` (input exceeds the per-minute token budget;
   * `maxTokens` is that budget).
   */
  readonly errorClass?: "context_overflow" | "request_too_large" | "token_rate_exceeded";
  /** Always false: re-sending the identical request cannot succeed. */
  readonly retryable?: boolean;
  readonly status?: number;
  /**
   * The context window the provider stated in this error, already written to
   * the model's capability so the next resolve uses it (capability-learned.ts).
   * Absent when the message stated no window.
   */
  readonly learnedLimit?: StatedLimit;
}> {}

/**
 * The provider rejected the model's own output: its server-side tool-call
 * parser failed (Ollama "XML syntax error on line 1: unexpected EOF", "error
 * parsing tool call") or its validator refused the call (Groq "Tool call
 * validation failed", `tool_use_failed`). The request was fine; sampling is
 * stochastic, so the identical request can succeed. The provider retry
 * schedule resamples it (on a stream, only before the first emitted event);
 * after that, recovery belongs to the caller (`recoveryFor` → `"resample"`).
 */
export class LLMMalformedOutputError extends Data.TaggedError("LLMMalformedOutputError")<{
  readonly message: string;
  readonly provider: LLMProvider;
  readonly status?: number;
}> {
  /** Always `"malformed_output"` (structural classification, see error-class.ts). */
  readonly errorClass = "malformed_output" as const;
  /** A resample of the identical request can succeed. */
  readonly retryable = true;
}

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
 * Ollama (typically Ollama Cloud) refused the credentials: HTTP 401/403.
 * Raised by the connection pre-flight (`checkOllamaConnection`); like
 * {@link ModelDiscoveryError} it is deliberately NOT part of {@link LLMErrors}.
 * `message` never contains the key.
 */
export class OllamaAuthError extends Data.TaggedError("OllamaAuthError")<{
  readonly message: string;
  /** HTTP status: 401 or 403. */
  readonly status: number;
  /** Endpoint that refused the request. */
  readonly endpoint: string;
  /** True when a key was sent (invalid key), false when none was configured. */
  readonly keyProvided: boolean;
}> {}

/**
 * Union of all LLM error types.
 */
export type LLMErrors =
  | LLMError
  | LLMRateLimitError
  | LLMTimeoutError
  | LLMParseError
  | LLMContextOverflowError
  | LLMMalformedOutputError;
