// File: src/kernel/loop/iterate-until.ts
/**
 * Iterative-refinement combinator — the highest-leverage move per the
 * strategic direction memo (2026-05-25).
 *
 * Replaces the hand-written `while (attempt < maxRetries) { ... }` pattern
 * shared by reflexion (improve loop), plan-execute-reflect (refine loop),
 * and code-action (verify loop). Each strategy invents its own iteration
 * counter, termination-check, and max-iters fallback. This combinator owns
 * the loop control; callers own the step logic + termination predicates.
 *
 * **PROTOTYPE STATUS:** First consumer = reflexion alone (per direction memo
 * Week 1-2). If reflexion migrates cleanly with ≥300 LOC saved AND parity
 * preserved (live LLM probe), proceed to plan-execute-reflect + code-action.
 * If not, revert this file + the reflexion migration with learnings logged
 * to the design spec.
 *
 * Spec: wiki/Architecture/Design-Specs/2026-05-25-strategic-direction-memo.md
 */
import { Effect } from "effect";

/**
 * Why the iteration terminated. Strategies map this to result envelope
 * metadata (e.g. status="completed" for "satisfied", status="partial" for
 * "stagnant" | "max-iters").
 */
export type TerminationReason =
  | { readonly kind: "satisfied"; readonly detail?: string }
  | { readonly kind: "stagnant"; readonly detail?: string }
  | { readonly kind: "max-iters"; readonly detail?: string }
  | { readonly kind: "custom"; readonly tag: string; readonly detail?: string };

/**
 * Step return shape — either continue with a new state, or terminate with
 * a state + reason. Combinator handles `max-iters` automatically; callers
 * never return that reason themselves.
 */
export type IterationDecision<S> =
  | { readonly kind: "continue"; readonly state: S }
  | { readonly kind: "terminate"; readonly state: S; readonly reason: TerminationReason };

/** Result of `iterateUntil`. */
export interface IterateUntilResult<S> {
  /** Final state when iteration terminated. */
  readonly final: S;
  /** Number of step invocations (≥1 unless `maxIters` was 0). */
  readonly iters: number;
  /** Why the iteration stopped. Always populated. */
  readonly reason: TerminationReason;
}

/**
 * Run `step(state, iter)` repeatedly until step returns terminate, or until
 * `maxIters` invocations have been made (whichever comes first).
 *
 * Generic over caller state `S`, error channel `E`, and Effect requirements
 * `R` — combinator imposes no constraint on what flows through. Caller owns
 * what `state` shape is.
 *
 * - `iter` argument starts at 1 (matching reflexion's `attempt` semantics).
 * - When `maxIters` is reached, the last continue-returned state is wrapped
 *   in `{ reason: { kind: "max-iters" } }`.
 * - Returns immediately if `maxIters` is 0 — `final` is `initial`, `iters`
 *   is 0, reason is `max-iters`.
 */
export function iterateUntil<S, E = never, R = never>(opts: {
  readonly initial: S;
  readonly step: (state: S, iter: number) => Effect.Effect<IterationDecision<S>, E, R>;
  readonly maxIters: number;
}): Effect.Effect<IterateUntilResult<S>, E, R> {
  return Effect.gen(function* () {
    let current: S = opts.initial;
    let i = 0;
    while (i < opts.maxIters) {
      i++;
      const decision = yield* opts.step(current, i);
      if (decision.kind === "terminate") {
        return { final: decision.state, iters: i, reason: decision.reason };
      }
      current = decision.state;
    }
    return {
      final: current,
      iters: i,
      reason: { kind: "max-iters" as const },
    };
  });
}

/** Type-narrowing helper for callers — `continueWith(newState)` saves one nested-object literal. */
export function continueWith<S>(state: S): IterationDecision<S> {
  return { kind: "continue", state };
}

/** Type-narrowing helper for callers. */
export function terminateWith<S>(state: S, reason: TerminationReason): IterationDecision<S> {
  return { kind: "terminate", state, reason };
}
