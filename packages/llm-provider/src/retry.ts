import { Duration, Effect, Schedule, Stream } from "effect";
import { recoveryFor } from "./error-class.js";
import type { LLMErrors, LLMTimeoutError } from "./errors.js";
import type { StreamEvent } from "./types.js";

/**
 * Whether the provider retry schedule may re-send this failed request.
 *
 * This is the single answer to "would the provider retry this error". Both
 * {@link retryPolicy} and {@link retryStreamBeforeFirstEmission} gate on it,
 * so a caller that needs to know whether the provider already spent its
 * retries on a failure should import this predicate, never copy it.
 *
 * Keys on the error's structural `retryable` flag (set from its class by
 * `mapProviderError`; always true on `LLMTimeoutError` and
 * `LLMMalformedOutputError`). An error built without the flag falls back to
 * its tag: only `LLMRateLimitError` retries (`LLMTimeoutError` always carries
 * the flag). So a 429 for an exhausted quota (`retryable: false`) is not
 * retried, and a malformed model output (`retryable: true`) is resampled.
 * A flag that disagrees with a known class loses to the class: an error
 * whose `errorClass` recovery is not `backoff`/`resample` (auth, not-found,
 * overflow, ...) is never re-sent as is.
 */
export function isRetryableLLMError(error: LLMErrors): boolean {
  if ("retryable" in error && typeof error.retryable === "boolean") {
    if (!error.retryable) return false;
    const cls = "errorClass" in error ? error.errorClass : undefined;
    if (cls === undefined) return true;
    const recovery = recoveryFor(cls, true);
    return recovery === "backoff" || recovery === "resample";
  }
  return error._tag === "LLMRateLimitError";
}

/**
 * Malformed model output is resampled, not waited out: nothing on the
 * provider side needs time to recover, so a backoff sleep is pure latency.
 */
const zeroDelayForResample = (error: LLMErrors, delay: Duration.Duration): Duration.Duration =>
  error._tag === "LLMMalformedOutputError" ? Duration.zero : delay;

/**
 * Retry policy for LLM calls — exponential backoff, up to 3 retries.
 *
 * Retries what {@link isRetryableLLMError} allows: rate limits, transient
 * 5xx / 529-overload / network faults (routed to `LLMRateLimitError` by
 * `mapProviderError`), timeouts, and malformed model output (a resample).
 * Permanent failures (4xx bad-request/auth, model-not-found, parse,
 * context-overflow) are NOT retried — retrying can't change them.
 * Malformed output retries with no delay (a resample); the attempt cap holds.
 */
export const retryPolicy = Schedule.intersect(
  Schedule.recurs(3),
  Schedule.exponential("1 second", 2.0).pipe(
    Schedule.passthrough<Duration.Duration, LLMErrors, never>,
    Schedule.modifyDelay(zeroDelayForResample),
  ),
).pipe(Schedule.whileInput<LLMErrors>(isRetryableLLMError));

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
    Schedule.whileInput<LLMErrors>((error) => !emittedAny && isRetryableLLMError(error)),
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
