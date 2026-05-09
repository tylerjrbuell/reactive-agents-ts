/**
 * Gateway tick handler.
 *
 * Single iteration of the gateway loop. Three phases:
 *  1. Heartbeat: emit heartbeat event, evaluate gateway policy,
 *     dispatch to executeEvent if policy says 'execute'.
 *  2. Cron: check due crons, evaluate per-cron, dispatch
 *     execute-approved entries.
 *  3. Daily housekeeping: prune stale chat sessions; if a 24h
 *     window has elapsed, run memory compaction + episodic prune.
 *
 * Mutable counters (heartbeatsFired, cronChecks, lastCompactionAt)
 * are accessed via getter/setter/incrementor deps so the caller's
 * let-bindings stay the source of truth.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, type ManagedRuntime } from 'effect'
import type { GatewayChatManager } from '../gateway-chat.js'
import type { GLog } from './gateway-bootstrap.js'
import type { makeExecuteEvent } from './execute-event.js'

export interface GatewayTickDeps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly runtime: ManagedRuntime.ManagedRuntime<any, never>
    readonly agentId: string
    readonly hasCustomHeartbeatInstruction: boolean
    readonly sessionTtlDays: number
    readonly gw: unknown
    readonly sched: unknown
    readonly glog: GLog
    readonly executeEvent: ReturnType<typeof makeExecuteEvent>
    readonly chatManager: GatewayChatManager
    readonly getStopped: () => boolean
    readonly incrementHeartbeats: () => number
    readonly incrementCronChecks: () => number
    readonly getLastCompactionAt: () => number
    readonly setLastCompactionAt: (v: number) => void
}

/**
 * Build the gateway tick callback. Returned function is the body of
 * `setInterval(tick, gatewayIntervalMs)` in ReactiveAgent.start().
 */
export const makeGatewayTick = (
    deps: GatewayTickDeps
): (() => Promise<void>) => {
    const {
        runtime,
        agentId,
        hasCustomHeartbeatInstruction,
        sessionTtlDays,
        gw,
        sched,
        glog,
        executeEvent,
        chatManager,
        getStopped,
        incrementHeartbeats,
        incrementCronChecks,
        getLastCompactionAt,
        setLastCompactionAt,
    } = deps

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schedAny = sched as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gwAny = gw as any

    return async () => {
        if (getStopped()) return
        try {
            // 1. Emit heartbeat and check policy — only run agent if a custom instruction was configured
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const hbEvent: any = await runtime.runPromise(
                schedAny.emitHeartbeat()
            )
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const decision: any = await runtime.runPromise(
                gwAny.processEvent(hbEvent)
            )
            const heartbeatCount = incrementHeartbeats()

            if (!hasCustomHeartbeatInstruction) {
                glog(
                    'debug',
                    `heartbeat #${heartbeatCount} → idle (no instruction configured)`
                )
            } else if (decision.action === 'execute') {
                const instruction =
                    hbEvent.metadata?.instruction ?? 'Check for work'
                glog(
                    'info',
                    `heartbeat #${heartbeatCount} → execute`,
                    {
                        instruction: instruction.slice(0, 80),
                    }
                )
                await executeEvent(hbEvent, 'heartbeat', instruction)
            } else {
                glog(
                    'debug',
                    `heartbeat #${heartbeatCount} → ${decision.action}`,
                    { reason: decision.reason }
                )
            }

            // 2. Check crons
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cronEvents: any[] = (await runtime.runPromise(
                schedAny.checkCrons(new Date())
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            )) as any
            const cronCheckCount = incrementCronChecks()
            if (cronEvents.length > 0) {
                glog(
                    'info',
                    `cron check #${cronCheckCount} → ${cronEvents.length} cron(s) due`
                )
            }
            for (const cronEvent of cronEvents) {
                if (getStopped()) break
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const cronDecision: any = await runtime.runPromise(
                    gwAny.processEvent(cronEvent)
                )
                if (cronDecision.action === 'execute') {
                    const cronInstruction =
                        cronEvent.metadata?.instruction ?? 'Cron task'
                    glog('info', `cron → execute`, {
                        instruction: cronInstruction.slice(0, 80),
                    })
                    await executeEvent(
                        cronEvent,
                        'cron',
                        cronInstruction
                    )
                } else {
                    glog('debug', `cron → ${cronDecision.action}`, {
                        reason: cronDecision.reason,
                    })
                }
            }

            // 3. Daily housekeeping: prune stale chat sessions
            await chatManager.pruneStaleSessions()

            // 4. Daily housekeeping: memory compaction + episodic prune
            if (Date.now() - getLastCompactionAt() > 86_400_000) {
                setLastCompactionAt(Date.now())
                await runtime.runPromise(
                    Effect.gen(function* () {
                        const memMod = yield* Effect.promise(
                            () => import('@reactive-agents/memory')
                        )
                        const compactionOpt = yield* Effect.serviceOption(
                            memMod.CompactionService
                        )
                        if (compactionOpt._tag !== 'Some') return
                        const gAgentId = agentId
                        yield* compactionOpt.value.compactProgressive(
                            gAgentId,
                            {
                                strategy: 'progressive' as const,
                                maxEntries: 1000,
                                intervalMs: 30 * 86_400_000,
                                decayFactor: 0.05,
                            }
                        )
                        yield* compactionOpt.value.pruneEpisodicLog(
                            gAgentId,
                            sessionTtlDays
                        )
                    }).pipe(Effect.catchAll(() => Effect.void))
                )
            }
        } catch (err) {
            glog(
                'error',
                `tick error: ${
                    err instanceof Error ? err.message : String(err)
                }`
            )
        }
    }
}
