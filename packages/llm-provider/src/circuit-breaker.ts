// File: src/circuit-breaker.ts
/**
 * Circuit Breaker — prevents cascading failures by fast-failing when
 * the underlying LLM provider is consistently erroring.
 *
 * States: CLOSED (normal) → OPEN (fast-fail) → HALF_OPEN (test one request)
 */
import { Effect } from "effect";
import type { LLMErrors } from "./errors.js";
import { LLMError } from "./errors.js";
import type { CircuitBreakerConfig } from "./retry.js";
import { defaultCircuitBreakerConfig } from "./retry.js";

type State = "closed" | "open" | "half_open";

export interface CircuitBreaker {
  /** Wrap an Effect with circuit breaker protection. */
  readonly protect: <A>(effect: Effect.Effect<A, LLMErrors>) => Effect.Effect<A, LLMErrors>;
  /** Current state. */
  readonly state: () => State;
  /** Reset to closed. */
  readonly reset: () => void;
}

/**
 * Create a circuit breaker with configurable thresholds.
 *
 * - After `failureThreshold` consecutive failures → OPEN (fast-fail).
 * - After `cooldownMs` → HALF_OPEN (allow one test request).
 * - If test request succeeds → CLOSED. If it fails → OPEN again.
 */
export const makeCircuitBreaker = (
  config: Partial<CircuitBreakerConfig> = {},
): CircuitBreaker => {
  const { failureThreshold, cooldownMs } = {
    ...defaultCircuitBreakerConfig,
    ...config,
  };

  let currentState: State = "closed";
  let consecutiveFailures = 0;
  let openedAt = 0;

  const onSuccess = () => {
    consecutiveFailures = 0;
    currentState = "closed";
  };

  const onFailure = () => {
    consecutiveFailures++;
    if (consecutiveFailures >= failureThreshold) {
      currentState = "open";
      openedAt = Date.now();
    }
  };

  return {
    protect: <A>(effect: Effect.Effect<A, LLMErrors>) =>
      Effect.gen(function* () {
        if (currentState === "open") {
          if (Date.now() - openedAt >= cooldownMs) {
            currentState = "half_open";
          } else {
            return yield* Effect.fail(
              new LLMError({
                message: `Circuit breaker OPEN — ${consecutiveFailures} consecutive failures. Retry after ${Math.ceil((cooldownMs - (Date.now() - openedAt)) / 1000)}s cooldown.`,
                provider: "custom",
                cause: undefined,
              }),
            );
          }
        }

        const result = yield* Effect.exit(effect);
        if (result._tag === "Success") {
          onSuccess();
          return result.value;
        }

        onFailure();
        return yield* Effect.failCause(result.cause);
      }),

    state: () => currentState,

    reset: () => {
      currentState = "closed";
      consecutiveFailures = 0;
      openedAt = 0;
    },
  };
};
