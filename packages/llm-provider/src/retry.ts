import { Duration, Effect, Schedule, Stream } from "effect";
import type { LLMErrors, LLMTimeoutError } from "./errors.js";
import type { StreamEvent } from "./types.js";

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

/**
 * `retryPolicy`'s streaming counterpart (EH-1, 2026-07-29 systems audit,
 * root cause #3). `complete()` is wired to `Effect.retry(retryPolicy)` on all
 * 5 providers; `stream()` — which is 100% of what the kernel's `think` calls
 * use — was not, so a single transient rate-limit/timeout/5xx during a stream
 * ended the entire run with zero retry.
 *
 * A bare `Stream.retry(retryPolicy)` is UNSAFE here: Effect restarts a failed
 * stream by re-invoking its producer from scratch, and if the first attempt
 * had already emitted some deltas before failing, the caller would see those
 * deltas followed by a second attempt's deltas from the beginning — duplicated
 * or corrupted output. `complete()` has no such risk (one response, not
 * incremental chunks), which is exactly why it was safe to wire directly.
 *
 * This wrapper is retryable ONLY up to the first emitted event. Once anything
 * has been emitted, `emittedAny` latches true for the rest of this stream's
 * lifetime (across any further retry attempts) and the schedule's predicate
 * permanently returns false — a failure after partial output always surfaces
 * to the caller rather than risking a silent restart mid-response.
 */
export function retryStreamBeforeFirstEmission<E extends LLMErrors, R>(
  stream: Stream.Stream<StreamEvent, E, R>,
): Stream.Stream<StreamEvent, E, R> {
  let emittedAny = false;
  const guardedPolicy = retryPolicy.pipe(
    Schedule.whileInput<LLMErrors>(
      (error) =>
        !emittedAny &&
        (error._tag === "LLMRateLimitError" || error._tag === "LLMTimeoutError"),
    ),
  );
  return stream.pipe(
    Stream.tap(() => Effect.sync(() => { emittedAny = true; })),
    Stream.retry(guardedPolicy),
  );
}

/**
 * `retryPolicy` + `Effect.timeout` + `TimeoutException`→`LLMTimeoutError`
 * combinator for the non-streaming `complete()` path. This exact shape was
 * duplicated verbatim across all 5 provider adapters' `complete()` — only
 * the constructed `LLMTimeoutError`'s fields (provider name, message text,
 * and provider-specific extras like `model`/`elapsedMs` on the local/ollama
 * adapter) varied between them. `onTimeout` is a factory rather than a
 * fixed error so each call site can still close over its own request-scoped
 * bindings (e.g. `model`, `startedAt`) when building the error.
 *
 * F4: callers resolve `timeoutMs` ONCE and pass the same binding here and
 * into `onTimeout`'s closure, so `Effect.timeout` and the error's restated
 * `timeoutMs` can never drift.
 */
export function withRetryAndTimeout<A, E extends LLMErrors, R>(
  effect: Effect.Effect<A, E, R>,
  options: {
    readonly timeoutMs: number;
    readonly onTimeout: () => LLMTimeoutError;
    readonly policy?: typeof retryPolicy;
  },
): Effect.Effect<A, E | LLMTimeoutError, R> {
  return effect.pipe(
    Effect.retry(options.policy ?? retryPolicy),
    Effect.timeout(Duration.millis(options.timeoutMs)),
    Effect.catchTag("TimeoutException", () => Effect.fail(options.onTimeout())),
  );
}

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
