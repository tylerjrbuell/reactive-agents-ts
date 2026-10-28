/**
 * Effect-stream → async-iteration pump for `ReactiveAgent.runStream()`.
 *
 * Extracted verbatim from `_runStreamImpl`: forks the Effect stream into an
 * interruptible fiber that pushes events into a JS queue, so an `AbortSignal`
 * stops the Effect fiber immediately — not just between yields. The consuming
 * generator pulls with `next()` and must call `dispose()` on every exit.
 */
import { Effect, Fiber, Stream as EStream, type ManagedRuntime } from 'effect'
import type { AgentStreamEvent } from '../stream-types.js'

/** One queued item: an event, or the end-of-stream sentinel (with the fiber's error, if any). */
export type StreamItem =
    | { done: false; value: AgentStreamEvent }
    | { done: true; error?: unknown }

export interface StreamPump {
    /**
     * Next queued item, waiting while the queue is empty. Resolves `undefined`
     * when the signal aborted while waiting (nothing further will arrive).
     */
    next(): Promise<StreamItem | undefined>
    /** Detach the abort listener and interrupt the consumer fiber. Idempotent. */
    dispose(): void
}

export const startStreamPump = (
    runtime: ManagedRuntime.ManagedRuntime<never, never>,
    stream: EStream.Stream<AgentStreamEvent, Error>,
    signal: AbortSignal | undefined,
): StreamPump => {
    const itemQueue: StreamItem[] = []
    let resolve: (() => void) | null = null

    const push = (item: StreamItem): void => {
        itemQueue.push(item)
        const r = resolve
        resolve = null
        r?.()
    }

    const consumeEffect = EStream.runForEach(stream, (event) =>
        Effect.sync(() => push({ done: false, value: event })),
    ).pipe(
        Effect.andThen(Effect.sync(() => push({ done: true }))),
        Effect.catchAll((err) => Effect.sync(() => push({ done: true, error: err }))),
    )

    const fiber = runtime.runFork(consumeEffect)

    // Interrupt the fiber when the signal fires, and also unblock any waiting
    // promise so the consumer loop can observe the abort.
    const onAbort = (): void => {
        Effect.runFork(Fiber.interrupt(fiber))
        const r = resolve
        resolve = null
        r?.()
    }
    signal?.addEventListener('abort', onAbort)

    return {
        async next() {
            while (true) {
                if (itemQueue.length === 0) {
                    // If the signal is already aborted (fiber interrupted), stop waiting.
                    if (signal?.aborted) return undefined
                    await new Promise<void>((res) => {
                        resolve = res
                    })
                    // After waking, check again if abort fired while we were waiting.
                    if (signal?.aborted && itemQueue.length === 0) return undefined
                }
                const item = itemQueue.shift()
                if (item !== undefined) return item
            }
        },
        dispose() {
            signal?.removeEventListener('abort', onAbort)
            Effect.runFork(Fiber.interrupt(fiber))
        },
    }
}
