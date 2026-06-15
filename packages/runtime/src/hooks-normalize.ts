import { Effect } from "effect";
import type { ExecutionContext } from "./types.js";
import type { ExecutionError } from "./errors.js";

/**
 * Everything a lifecycle hook handler is allowed to return.
 *
 * Plain values (`ExecutionContext` or `void`) and `Promise`s let users write
 * hooks without importing Effect. The `Effect` form is retained for
 * backward compatibility with handlers written before the widening.
 *
 *   - return a (modified) `ExecutionContext` → it replaces the context
 *   - return `void`/`undefined`               → observe-only, context unchanged
 *   - return a `Promise` of either            → same, async
 *   - return an `Effect`                      → same, Effect (legacy form)
 */
export type RawHookResult =
  | ExecutionContext
  | void
  | Promise<ExecutionContext | void>
  | Effect.Effect<ExecutionContext, ExecutionError>;

/** Narrow a value to a thenable without an `any` cast. */
function isThenable(u: unknown): u is Promise<unknown> {
  return (
    typeof u === "object" &&
    u !== null &&
    typeof (u as { then?: unknown }).then === "function"
  );
}

/**
 * Call `handler(ctx)` and normalize whatever it returns into a single
 * `Effect` that yields the next `ExecutionContext`.
 *
 * - `void`/`undefined`         → succeed with the unchanged `ctx`
 * - `Effect`                   → run as-is (mapping a void result to `ctx`)
 * - `Promise`                  → `Effect.tryPromise` (void result → `ctx`)
 * - plain `ExecutionContext`   → succeed with it
 *
 * A synchronous throw, a rejected promise, or a failed Effect all surface on
 * the error channel as the raw cause (`unknown`). The caller (`hooks.ts`
 * registry) maps that to a `HookError` where `phase`/`timing` are in scope —
 * keeping `HookError` construction in one place.
 */
export function normalizeHookResult(
  handler: (ctx: ExecutionContext) => RawHookResult,
  ctx: ExecutionContext,
): Effect.Effect<ExecutionContext, unknown> {
  return Effect.suspend(() => {
    let raw: RawHookResult;
    try {
      raw = handler(ctx);
    } catch (err) {
      return Effect.fail(err);
    }

    // `void` is `undefined` at runtime; the `null` arm defends against untyped
    // JS callers (the builder API is consumed from plain JS too) that return
    // `null` from a handler — treat both as "observe-only, context unchanged".
    if (raw === undefined || raw === null) {
      return Effect.succeed(ctx);
    }
    if (Effect.isEffect(raw)) {
      // Safe narrowing: RawHookResult constrains the Effect arm to
      // Effect<ExecutionContext, ExecutionError>; we only widen the error
      // channel to `unknown` to unify it with the throw/reject paths.
      // The `?? ctx` is defensive — the type says the success is always an
      // ExecutionContext, but an untyped-JS Effect could resolve to undefined.
      return (raw as Effect.Effect<ExecutionContext, unknown>).pipe(
        Effect.map((r) => r ?? ctx),
      );
    }
    if (isThenable(raw)) {
      return Effect.tryPromise({
        try: () => raw as Promise<ExecutionContext | void>,
        catch: (err) => err,
      }).pipe(Effect.map((r) => r ?? ctx));
    }
    return Effect.succeed(raw);
  });
}

/**
 * Run an already-produced hook return value purely for its side effects —
 * the harness-mirror path observes hooks and discards any returned context.
 *
 * Unlike {@link normalizeHookResult} this takes the *result* (not the handler)
 * because the mirror calls the handler itself inside its own try/catch. An
 * `Effect` is executed via `Effect.runPromise` (fixing a latent gap where a
 * lazy Effect previously never ran on this path); a `Promise` is awaited; a
 * plain value is ignored. Failures reject so the caller's error handler fires.
 */
export async function runHookResultForSideEffect(
  raw: RawHookResult,
): Promise<void> {
  if (raw === undefined || raw === null) return;
  if (Effect.isEffect(raw)) {
    await Effect.runPromise(raw as Effect.Effect<ExecutionContext, unknown>);
    return;
  }
  if (isThenable(raw)) {
    await raw;
  }
  // Plain ExecutionContext: observation-only path discards it.
}
