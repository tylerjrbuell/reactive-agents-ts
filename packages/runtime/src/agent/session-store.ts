/**
 * Durable chat-session history for `ReactiveAgent.session({ persist: true })`.
 *
 * Extracted verbatim from `session()`: persists/loads a session's messages
 * through the memory package's `SessionStoreService` when it is wired into the
 * agent's runtime. Both operations degrade gracefully — a missing store is a
 * no-op/empty history, and a failing save is recorded as a swallowed error
 * (the in-memory turn already succeeded).
 */
import { Effect, type ManagedRuntime } from 'effect'
import { emitErrorSwallowed, errorTag } from '@reactive-agents/core'
import type { ChatMessage } from '../chat.js'

export interface SessionHistoryStore {
    readonly save: (sessionId: string, messages: readonly ChatMessage[]) => Promise<void>
    readonly load: (sessionId: string) => Promise<readonly ChatMessage[]>
}

export const makeSessionHistoryStore = (
    runtime: ManagedRuntime.ManagedRuntime<never, unknown>,
    agentId: string,
): SessionHistoryStore => ({
    save: async (sid, messages) => {
        await runtime.runPromise(
            Effect.gen(function* () {
                const memMod = yield* Effect.promise(() => import('@reactive-agents/memory'))
                const storeOpt = yield* Effect.serviceOption(memMod.SessionStoreService)
                if (storeOpt._tag !== 'Some') return
                yield* storeOpt.value.save({ sessionId: sid, agentId, messages: [...messages] })
            }).pipe(
                Effect.catchAll((err) =>
                    emitErrorSwallowed({
                        site: 'runtime/src/agent/session-store.ts:session-save',
                        tag: errorTag(err),
                    }),
                ),
            ),
        )
    },
    load: (sid) =>
        runtime.runPromise(
            Effect.gen(function* () {
                const memMod = yield* Effect.promise(() => import('@reactive-agents/memory'))
                const storeOpt = yield* Effect.serviceOption(memMod.SessionStoreService)
                if (storeOpt._tag !== 'Some') return [] as ChatMessage[]
                const record = yield* storeOpt.value.findById(sid)
                return (record?.messages ?? []) as ChatMessage[]
            }).pipe(Effect.catchAll((_err) => Effect.succeed([] as ChatMessage[]))),
        ),
})
