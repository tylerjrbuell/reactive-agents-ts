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
 *
 * -----------------------------------------------------------------
 * Narrow `unknown` error channels — when intentional
 * -----------------------------------------------------------------
 *
 * Reading the codebase you will see roughly 20 declarations of the
 * shape `Effect.Effect<X, unknown>` inside narrow service-interface
 * shims (e.g. `ContextManagerLike`, kernel `SkillStoreService` shims,
 * `LearningEngine.store`). These are NOT silent-swallow sites and
 * should NOT be migrated wholesale to tagged errors.
 *
 * The pattern is:
 *
 * ```ts
 * const someServiceOpt = yield* Effect.serviceOption(
 *   Context.GenericTag<{
 *     doThing: (args: X) => Effect.Effect<Y, unknown>;
 *   }>("SomeService"),
 * );
 * ```
 *
 * Why `unknown` is correct here:
 *
 *   1. **Cross-package error-type coupling.** The consumer (runtime,
 *      reasoning, RI) does not — and should not — depend on the
 *      provider package's concrete error tagged union. Importing
 *      `SkillStoreError` into runtime/reasoning would pull a memory-
 *      layer dependency into kernels that intentionally don't know
 *      about memory.
 *
 *   2. **The framework absorbs the error at the boundary.** Callers
 *      wrap the shim with `Effect.catchAll` / `Effect.either` /
 *      `Effect.option` and translate failure into a kernel decision
 *      (skip this phase, log + continue, escalate). The error type
 *      never escapes the boundary.
 *
 *   3. **Optional-service dispatch.** Many shims are loaded via
 *      `Effect.serviceOption` and live behind a `_tag: "Some" | "None"`
 *      gate. The error-channel type is irrelevant at the call site
 *      because the call site already handles `None` and reflexively
 *      catches any thrown error from `Some`.
 *
 * When `unknown` is a SMELL (DO migrate):
 *
 *   • The error is produced and consumed inside the same package
 *     (no cross-package boundary to defend).
 *   • The producer is a framework-internal Effect chain that already
 *     uses tagged kinds — `unknown` is a regression that loses tag info.
 *   • The site is a production Effect, not a service-interface shim.
 *   • A retry rule, observability classifier, or debrief feature
 *     needs to pattern-match on `_tag` and currently cannot.
 *
 * Anti-regression: `packages/runtime/test/no-silent-swallow-floor.test.ts`
 * pins a TypeScript-AST count of these `Effect<X, unknown>` sites
 * across runtime + reasoning + reactive-intelligence src trees. New
 * additions surface as test failures; reviewer must classify the
 * new site as narrow-shim (raise ceiling + comment referencing this
 * doc-block) or smell (migrate to a tagged kind).
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
