/**
 * Report a gateway schedule fire's outcome back to the durable ScheduleRegistry.
 *
 * Cron events carry `metadata.scheduleId` and `metadata.fireId` (gateway
 * `createScheduleEvent`). When the inbound queue settles such an event, this reporter
 * calls `registry.completeRun` (succeeded / failed / skipped) and, for a successful run
 * whose schedule has a `delivery` target, delivers the output through
 * `ChannelService.deliver` and records the receipt (`deliverScheduleResult`).
 * Events without a `scheduleId` (heartbeat, channel, webhook) are ignored.
 */

import { Effect, type ManagedRuntime } from 'effect'
import type { ScheduleRegistryService } from '@reactive-agents/gateway'
import type { ChannelService, deliverScheduleResult } from '@reactive-agents/channels'
import type { GLog } from './gateway-bootstrap.js'
import type { InboundQueueSettled } from './gateway-inbound-queue.js'

export interface ScheduleReporterDeps {
    readonly runtime: ManagedRuntime.ManagedRuntime<never, never>
    readonly registry: ScheduleRegistryService
    /** Present when `.withChannels()` is configured; delivery is skipped without it. */
    readonly channels: Pick<ChannelService, 'deliver'> | null
    readonly deliver: typeof deliverScheduleResult
    readonly glog: GLog
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

const targetOf = (v: unknown): { adapterId: string; conversationId: string } | undefined => {
    if (typeof v !== 'object' || v === null) return undefined
    const adapterId = str((v as { adapterId?: unknown }).adapterId)
    const conversationId = str((v as { conversationId?: unknown }).conversationId)
    return adapterId && conversationId ? { adapterId, conversationId } : undefined
}

/** Build the `onSettled` handler for the gateway inbound queue. */
export const makeScheduleReporter =
    (deps: ScheduleReporterDeps) =>
    async (settled: InboundQueueSettled): Promise<void> => {
        const meta =
            typeof settled.event === 'object' && settled.event !== null
                ? ((settled.event as { metadata?: Record<string, unknown> }).metadata ?? {})
                : {}
        const scheduleId = str(meta['scheduleId'])
        const fireId = str(meta['fireId'])
        if (!scheduleId || !fireId) return

        const status =
            settled.outcome === 'skipped'
                ? 'skipped'
                : settled.output === undefined
                  ? 'failed'
                  : 'succeeded'
        const error =
            settled.outcome === 'skipped'
                ? settled.reason
                : settled.output === undefined
                  ? 'run failed'
                  : undefined

        const program = Effect.gen(function* () {
            yield* deps.registry.completeRun(scheduleId, fireId, {
                status,
                ...(error !== undefined ? { error } : {}),
            })
            const target = targetOf(meta['delivery'])
            if (status === 'succeeded' && target && deps.channels && settled.outcome === 'ran') {
                yield* deps.deliver(
                    deps.channels,
                    deps.registry,
                    { scheduleId, fireId, delivery: target },
                    settled.output ?? ''
                )
            }
        }).pipe(
            Effect.catchAll((err) =>
                Effect.sync(() =>
                    deps.glog('warn', `schedule ${scheduleId} report failed: ${String((err as { _tag?: string })._tag ?? err)}`)
                )
            )
        )
        await deps.runtime.runPromise(program)
    }
