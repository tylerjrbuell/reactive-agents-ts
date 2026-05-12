/**
 * Gateway chat manager factory.
 *
 * Builds the GatewayChatManager from the configuration on the
 * builder + the bootstrapped runtime services. Owns chatDeps wiring
 * for executeEvent, logEpisode, recallEpisodes, and any other
 * callbacks the manager needs.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, type ManagedRuntime } from 'effect'
import {
    GatewayChatManager,
    type GatewayChatManagerDeps,
} from '../gateway-context-formatting.js'
import type { makeExecuteEvent } from './execute-event.js'

export interface ChatManagerFactoryDeps {
    readonly agentId: string
    readonly gatewayOptions:
        | {
              accessControl?: {
                  mode?: 'chat' | 'task'
                  sessionTtlDays?: number
              }
          }
        | undefined
    readonly runtime: ManagedRuntime.ManagedRuntime<unknown, unknown>
    readonly executeEvent: ReturnType<typeof makeExecuteEvent>
}

export const createChatManager = (
    deps: ChatManagerFactoryDeps
): GatewayChatManager => {
    const sessionTtlDays: number =
        deps.gatewayOptions?.accessControl?.sessionTtlDays ?? 30

    const chatDeps: GatewayChatManagerDeps = {
        agentId: deps.agentId,
        sessionTtlDays,
        executeEvent: (event, source, instruction) =>
            deps.executeEvent(event as any, source, instruction),
        logEpisode: async (entry) => {
            await deps.runtime.runPromise(
                Effect.gen(function* () {
                    const memMod = yield* Effect.promise(
                        () => import('@reactive-agents/memory')
                    )
                    const svcOpt = yield* Effect.serviceOption(
                        memMod.EpisodicMemoryService
                    )
                    if (svcOpt._tag !== 'Some') return
                    yield* svcOpt.value.log(entry as any)
                }).pipe(Effect.catchAll(() => Effect.void))
            )
        },
        saveSession: async (input) => {
            await deps.runtime.runPromise(
                Effect.gen(function* () {
                    const memMod = yield* Effect.promise(
                        () => import('@reactive-agents/memory')
                    )
                    const storeOpt = yield* Effect.serviceOption(
                        memMod.SessionStoreService
                    )
                    if (storeOpt._tag !== 'Some') return
                    yield* storeOpt.value.save(input as any)
                }).pipe(Effect.catchAll(() => Effect.void))
            )
        },
        findById: async (sessionId) => {
            return deps.runtime.runPromise(
                Effect.gen(function* () {
                    const memMod = yield* Effect.promise(
                        () => import('@reactive-agents/memory')
                    )
                    const storeOpt = yield* Effect.serviceOption(
                        memMod.SessionStoreService
                    )
                    if (storeOpt._tag !== 'Some') return null
                    const record = yield* storeOpt.value.findById(sessionId)
                    return record
                        ? { messages: record.messages as any }
                        : null
                }).pipe(Effect.catchAll(() => Effect.succeed(null)))
            )
        },
        getRecentEpisodes: async (agentId, limit) => {
            return deps.runtime.runPromise(
                Effect.gen(function* () {
                    const memMod = yield* Effect.promise(
                        () => import('@reactive-agents/memory')
                    )
                    const episodicOpt = yield* Effect.serviceOption(
                        memMod.EpisodicMemoryService
                    )
                    if (episodicOpt._tag !== 'Some') return []
                    return yield* episodicOpt.value.getRecent(agentId, limit)
                }).pipe(Effect.catchAll(() => Effect.succeed([])))
            )
        },
        cleanup: async (ttlDays) => {
            return deps.runtime.runPromise(
                Effect.gen(function* () {
                    const memMod = yield* Effect.promise(
                        () => import('@reactive-agents/memory')
                    )
                    const storeOpt = yield* Effect.serviceOption(
                        memMod.SessionStoreService
                    )
                    if (storeOpt._tag !== 'Some') return 0
                    return yield* storeOpt.value.cleanup(ttlDays)
                }).pipe(Effect.catchAll(() => Effect.succeed(0)))
            )
        },
    }

    return new GatewayChatManager(chatDeps)
}
