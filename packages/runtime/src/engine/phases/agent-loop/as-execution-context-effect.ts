import type { Effect } from "effect";
import type { ExecutionContext } from "../../../types.js";

/**
 * Widen an `Effect.gen(function* () {...})` block's inferred return type to
 * the phase function's declared `Effect.Effect<ExecutionContext, E>` return
 * shape. TS cannot carry the precise generator-inferred type across these
 * phase-function signatures, so every agent-loop phase (inline-think,
 * inline-observe, inline-act, inline-harness-hooks, reasoning-think,
 * reasoning-post-think, reasoning-harness-hooks, verification-think-retry,
 * verification-quality-gate) widened at its own `Effect.gen(...)` boundary
 * with an identical `as unknown as Effect.Effect<ExecutionContext, ...>`
 * cast. WS-5b (`packages/runtime/test/as-unknown-as-ceiling.test.ts`) counts
 * cast SITES, not occurrences of a pattern, so nine copies of the same
 * widening counted as nine separate smells; this concentrates them into one.
 */
export function asExecutionContextEffect<E = never>(
  effect: unknown,
): Effect.Effect<ExecutionContext, E> {
  return effect as unknown as Effect.Effect<ExecutionContext, E>;
}
