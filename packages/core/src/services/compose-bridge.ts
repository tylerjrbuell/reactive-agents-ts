/**
 * Compose bridge — single canonical helper that publishes a typed payload
 * through a `HarnessPipeline` instance.
 *
 * Why this file exists (HS-112):
 *   Kernel-side code (act, verify, RI dispatcher, …) needs to emit Compose
 *   tags so external observers can tap previously-dead tag namespaces
 *   (`observation.tool-result`, `nudge.healing-failure`, `lifecycle.failure`,
 *   `control.strategy-evaluated`). The pipeline lives across a
 *   class/Promise/Effect boundary; calling `.transform()` directly from an
 *   `Effect.gen` block is awkward and easy to get wrong (forgetting
 *   `catchAll` would let a user-registered transform crash the kernel).
 *
 * Invariants:
 *   1. **Always-success.** Tag emission is observational; it never propagates
 *      failure. Any error from a user-registered transform/tap is suppressed
 *      so the kernel iteration cannot be derailed by an external observer.
 *   2. **No-op when no pipeline.** Callers don't gate; the helper does. If
 *      no `.withHarness()` block was registered, this is a zero-cost call.
 *   3. **Discard return value.** The transform's *output* is irrelevant at
 *      these emit sites — callers don't substitute the payload back into
 *      state. Suppression (`null`) is therefore meaningless here.
 *
 * Consumers wanting transform-driven substitution (e.g. prompt rewriting at
 * the system-prompt boundary) should call `pipeline.transform()` directly
 * and read the result.
 */
import { Effect } from "effect";
import type { HarnessPipeline } from "./harness-pipeline.js";
import type { Tag, PayloadFor, ContextFor } from "./harness-types.js";

/**
 * Publish `payload` on `tag` through `pipeline`. Always succeeds.
 *
 * @param pipeline May be `undefined` — the caller passes whatever pipeline
 *   handle is in scope (kernel input, intervention context, etc.) without
 *   guarding.
 * @param tag The Compose tag to emit.
 * @param payload The default value seen by transforms/taps.
 * @param ctx Tag-specific context.
 * @returns `Effect<void, never>` — observers cannot break the kernel loop.
 */
export const emitToCompose = <T extends Tag>(
  pipeline: HarnessPipeline | undefined,
  tag: T,
  payload: PayloadFor<T>,
  ctx: ContextFor<T>,
): Effect.Effect<void, never> =>
  pipeline === undefined
    ? Effect.void
    : Effect.tryPromise(() => pipeline.transform(tag, payload, ctx)).pipe(
        Effect.asVoid,
        Effect.catchAll(() => Effect.void),
      );
