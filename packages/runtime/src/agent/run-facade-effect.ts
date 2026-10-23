/**
 * Shared Effect→Promise bridge for the agent facade families (Quality program
 * Task 6 / D1 bridge; first consumer: `agent/skills-facade.ts`, families 2-4
 * [judgment, durable, run-task] adopt this same helper instead of growing a
 * private copy per family in `reactive-agent.ts`).
 *
 * A facade method returns `Effect.Effect<A, E, R>`; the class shell runs it
 * through the agent's ManagedRuntime and is the family's ONLY Promise
 * boundary.
 *
 * Why not a plain `runPromise` call: verified empirically on effect@3.19,
 * `ManagedRuntime.runPromise` rejects typed failures AND defects with a
 * fresh `FiberFailure` wrapper, so e.g. `agent.exportSkill('missing')` would
 * reject with the wrapper rather than the exact
 * `Error('Skill "missing" not found')` instance the pre-bridge async facade
 * method rejected with. Folding the error channel into an `Either`
 * (`Effect.either`) makes runPromise RESOLVE with the original value; the
 * Left arm is re-raised verbatim via `Promise.reject`. `catchAllDefect`
 * first converts any residual defect into a typed failure carrying the same
 * defect value - mirroring async-method semantics where a sync throw
 * rejected with that exact value.
 *
 * Identity contract for adopters: values entering `E` must be the RAW
 * rejection values the pre-bridge code produced (no Cause-wrapping, no
 * re-wrapping in `new Error`). The seam tripwires for that contract are the
 * `Effect.either` identity pins in
 * `packages/runtime/tests/seam-agent-skills-facade.test.ts`.
 */
import { Effect, Either, ManagedRuntime } from 'effect'

export const runFacadeEffect = <A, E, R>(
    runtime: ManagedRuntime.ManagedRuntime<any, never>,
    effect: Effect.Effect<A, E, R>,
): Promise<A> =>
    runtime
        .runPromise(
            effect.pipe(
                Effect.catchAllDefect((defect) => Effect.fail(defect)),
                Effect.either,
            ),
        )
        .then((either) =>
            Either.isLeft(either) ? Promise.reject(either.left) : either.right,
        )
