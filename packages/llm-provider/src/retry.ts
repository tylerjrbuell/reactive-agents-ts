import { Schedule } from "effect";
import type { LLMErrors } from "./errors.js";

/**
 * Retry policy for LLM calls.
 * Handles rate limits with exponential backoff.
 * Only retries on rate limit and timeout errors.
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
