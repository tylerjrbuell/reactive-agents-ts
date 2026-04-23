/**
 * Framework error taxonomy.
 *
 * All framework-emitted errors extend one of six top-level kinds:
 * `TransientError`, `CapacityError`, `CapabilityError`, `ContractError`,
 * `TaskError`, `SecurityError`. Retry rules pattern-match on `_tag` via
 * Effect's `catchTag` / `catchTags`.
 *
 * Existing errors (`AgentError`, `AgentNotFoundError`, `TaskError`,
 * `ValidationError`, `RuntimeError`) are re-exported unchanged from
 * `./errors` — `TaskError` now also serves as the Task-kind umbrella.
 *
 * @example Catch a specific error tag:
 * ```ts
 * pipe(
 *   someEffect,
 *   Effect.catchTag("LLMRateLimitError", (e) =>
 *     Effect.succeed({ retryAfterMs: e.retryAfterMs ?? 1000 }),
 *   ),
 * );
 * ```
 *
 * @example Classify retry eligibility:
 * ```ts
 * if (isRetryable(err)) {
 *   // apply retry rule pipeline
 * }
 * ```
 */

// Pre-existing exports (backward compatible)
export {
  AgentError,
  AgentNotFoundError,
  TaskError,
  ValidationError,
  RuntimeError,
} from "./errors.js";

// Framework-error base
export { FrameworkError } from "./framework-error.js";

// Top-level kinds + subtypes
export { TransientError, LLMTimeoutError } from "./transient.js";
export { CapacityError, LLMRateLimitError } from "./capacity.js";
export { CapabilityError, ModelCapabilityError } from "./capability.js";
export { ContractError, ToolIdempotencyViolation } from "./contract.js";
export { SecurityError, ToolCapabilityViolation } from "./security.js";
export { VerificationFailed } from "./task-subtypes.js";

// Retry classifier
export { isRetryable } from "./is-retryable.js";
