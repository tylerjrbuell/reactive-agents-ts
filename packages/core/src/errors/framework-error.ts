import { Data } from "effect";

/**
 * Top-level framework error. Every framework-emitted error extends one of
 * the six kind-specific subclasses:
 *
 *   TransientError   — environmental fault, retryable with backoff
 *   CapacityError    — overload/rate-limit, retryable with jitter
 *   CapabilityError  — structural gap, NOT retryable
 *   ContractError    — our code is wrong, NOT retryable
 *   TaskError        — task is ill-formed/unsolvable, NOT retryable as-is
 *   SecurityError    — policy violation, NOT retryable (escalate)
 *
 * Use `isRetryable(err)` from `@reactive-agents/core/errors` to classify.
 *
 * @see isRetryable
 */
export class FrameworkError extends Data.TaggedError("FrameworkError")<{
  readonly message: string;
}> {}
