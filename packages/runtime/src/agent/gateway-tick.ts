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

import { Effect, type Context, type ManagedRuntime } from 'effect'
import type {
    GatewayService as GatewayServiceTag,
    SchedulerService as SchedulerServiceTag,
} from '@reactive-agents/gateway'
import type { GatewayChatManager } from '../gateway-context-formatting.js'
import type { GLog } from './gateway-bootstrap.js'
import type { makeExecuteEvent } from './execute-event.js'

type GatewayService = Context.Tag.Service<typeof GatewayServiceTag>
type SchedulerService = Context.Tag.Service<typeof SchedulerServiceTag>

export interface GatewayTickDeps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly runtime: ManagedRuntime.ManagedRuntime<any, never>
    readonly agentId: string
    readonly hasCustomHeartbeatInstruction: boolean
    readonly sessionTtlDays: number
    readonly gw: GatewayService
    readonly sched: SchedulerService
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

    return async () => {
        if (getStopped()) return
        try {
            // 1. Emit heartbeat and check policy — only run agent if a custom instruction was configured
            const hbEvent = await runtime.runPromise(sched.emitHeartbeat())
            const decision = await runtime.runPromise(gw.processEvent(hbEvent))
            const heartbeatCount = incrementHeartbeats()

            if (!hasCustomHeartbeatInstruction) {
                glog(
                    'debug',
                    `heartbeat #${heartbeatCount} → idle (no instruction configured)`
                )
            } else if (decision.action === 'execute') {
                const instructionRaw = hbEvent.metadata?.instruction
                const instruction =
                    typeof instructionRaw === 'string'
                        ? instructionRaw
                        : 'Check for work'
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
                    { reason: 'reason' in decision ? decision.reason : undefined }
                )
            }

            // 2. Check crons
            const cronEvents = await runtime.runPromise(
                sched.checkCrons(new Date())
            )
            const cronCheckCount = incrementCronChecks()
            if (cronEvents.length > 0) {
                glog(
                    'info',
                    `cron check #${cronCheckCount} → ${cronEvents.length} cron(s) due`
                )
            }
            for (const cronEvent of cronEvents) {
                if (getStopped()) break
                const cronDecision = await runtime.runPromise(
                    gw.processEvent(cronEvent)
                )
                if (cronDecision.action === 'execute') {
                    const cronInstructionRaw = cronEvent.metadata?.instruction
                    const cronInstruction =
                        typeof cronInstructionRaw === 'string'
                            ? cronInstructionRaw
                            : 'Cron task'
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
                        reason:
                            'reason' in cronDecision
                                ? cronDecision.reason
                                : undefined,
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
