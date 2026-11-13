/**
 * Promise boundary for scoped Effect resources (router host, ingress server).
 *
 * `Effect.runPromise` rejects with a `FiberFailure` wrapper, so a caller documented to receive a
 * tagged error (`RoutingError`) would never match on it. {@link runTyped} rejects with the
 * squashed cause instead: the typed failure itself, or the defect.
 */
import { Cause, Effect, Exit, Scope } from 'effect'

/** Run `effect`; resolve with its value or reject with the squashed cause (the tagged error itself). */
export const runTyped = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
    const exit = await Effect.runPromiseExit(effect)
    return Exit.isSuccess(exit)
        ? exit.value
        : Promise.reject(Cause.squash(exit.cause))
}

/** A value built inside a scope, plus the function that closes that scope. */
export interface Started<A> {
    readonly value: A
    /** Close the scope (runs the value's finalizers). Rejects with the squashed cause on a finalizer defect. */
    readonly stop: () => Promise<void>
}

/**
 * Build `effect` inside a fresh scope. On failure the scope is closed (nothing is left running)
 * and the call rejects with the typed error.
 */
export const startScoped = async <A, E>(
    effect: Effect.Effect<A, E, Scope.Scope>
): Promise<Started<A>> => {
    const scope = Effect.runSync(Scope.make())
    const stop = () => runTyped(Scope.close(scope, Exit.void))
    try {
        const value = await runTyped(Scope.extend(effect, scope))
        return { value, stop }
    } catch (error) {
        await stop().catch(() => undefined)
        return Promise.reject(error)
    }
}
