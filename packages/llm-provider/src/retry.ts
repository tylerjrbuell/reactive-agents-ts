import { Schedule } from "effect";
import type { LLMErrors } from "./errors.js";

/**
 * Retry policy for LLM calls — exponential backoff, up to 3 retries.
 *
 * Retries the two retryable classes: `LLMRateLimitError` (429 AND transient
 * 5xx / 529-overload / network faults — see `mapProviderError`, which routes
 * those to this class since the remediation is identical: back off and retry)
 * and `LLMTimeoutError`. Permanent failures (4xx bad-request/auth, model-not-
 * found, parse, context-overflow) are NOT retried — retrying can't change them.
 */
export const retryPolicy = Schedule.intersect(
  Schedule.recurs(3),
  Schedule.exponential("1 second", 2.0),
).pipe(
  Schedule.whileInput<LLMErrors>(
    (error) =>
      error._tag === "LLMRateLimitError" || error._tag === "LLMTimeoutError",
  ),
);

// ─── Circuit Breaker ───

export type CircuitBreakerConfig = {
  readonly failureThreshold: number;
  readonly cooldownMs: number;
  readonly halfOpenRequests: number;
};

export const defaultCircuitBreakerConfig: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  halfOpenRequests: 1,
};
