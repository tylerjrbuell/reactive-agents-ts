import { Data } from "effect";

/**
 * Capacity failure — the provider/endpoint is overloaded, rate-limited,
 * or returning quota-related errors. Retryable with exponential backoff +
 * jitter, typically honoring server-supplied retry-after hints.
 *
 * @see isRetryable — returns true
 */
export class CapacityError extends Data.TaggedError("CapacityError")<{
  readonly message: string;
  readonly retryAfterMs?: number;
}> {}

/**
 * LLM provider rate-limited the request (e.g. HTTP 429 response). When
 * `retryAfterMs` is present, retry rules honor it as the minimum delay.
 */
export class LLMRateLimitError extends Data.TaggedError("LLMRateLimitError")<{
  readonly retryAfterMs?: number;
  readonly provider?: string;
  readonly message: string;
}> {}
