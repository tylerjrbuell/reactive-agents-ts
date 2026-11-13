/**
 * One `Scope` per started gateway.
 *
 * Startup is async and `stop()` can land at any point inside it. Each resource the startup
 * acquires (heartbeat timer, channel subscription, router host, ingress server, chat manager)
 * registers its cleanup here the moment it exists. `close()` runs the cleanups in reverse
 * acquisition order. A cleanup registered AFTER `close()` runs immediately (Scope semantics), so
 * a resource that finishes acquiring after an early `stop()` is torn down, never leaked.
 *
 * A failing cleanup is reported through `onError` and never stops the remaining cleanups.
 */
import { Cause, Effect, Exit, Scope } from 'effect'

/** The gateway's resource scope. */
export interface GatewayLifecycle {
    /** Register `cleanup`; runs on `close()`, or right away when the lifecycle is already closed. */
    readonly onClose: (
        label: string,
        cleanup: () => void | Promise<void>
    ) => Promise<void>
    /** Run every registered cleanup, newest first. Idempotent. */
    readonly close: () => Promise<void>
}

/**
 * Create a gateway lifecycle.
 *
 * @param onError - Called with the cleanup label and the failure when a cleanup throws or rejects.
 */
export const makeGatewayLifecycle = (
    onError: (label: string, error: unknown) => void
): GatewayLifecycle => {
    const scope = Effect.runSync(Scope.make())
    return {
        onClose: (label, cleanup) =>
            Effect.runPromise(
                Scope.addFinalizer(
                    scope,
                    Effect.tryPromise({
                        try: async () => cleanup(),
                        catch: (error) => error,
                    }).pipe(
                        Effect.catchAllCause((cause) =>
                            Effect.sync(() => onError(label, Cause.squash(cause)))
                        )
                    )
                )
            ),
        close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    }
}
