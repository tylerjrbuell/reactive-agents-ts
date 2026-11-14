/**
 * Gateway loop driver.
 *
 * Subscribes to ChannelMessageReceived events for push-based
 * messaging (with sender:message dedup window), and builds the
 * GatewayHandle that the caller uses to stop the loop and read
 * the final summary.
 *
 * The stop() handler sets stopped=true, closes the gateway lifecycle scope
 * (gateway-lifecycle.ts), assembles the summary and resolves `done`.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, type Context, type ManagedRuntime } from 'effect'
import type { EventBus } from '@reactive-agents/core'
import type { GatewayService as GatewayServiceTag } from '@reactive-agents/gateway'
import type { GatewayChatManager } from '../gateway-context-formatting.js'
import { deliveryKey, makeDeliveryDedup } from './channel-dedup.js'
import type {
    GatewayHandle,
    GatewaySummary,
} from '../builder/types.js'
import type { GLog } from './gateway-bootstrap.js'
import { outboundServerOf } from './gateway-outbound-requirement.js'
import type { GatewayInboundQueue } from './gateway-inbound-queue.js'

type GatewayService = Context.Tag.Service<typeof GatewayServiceTag>
type EventBusService = Context.Tag.Service<typeof EventBus>

/**
 * Dependencies for the channel-message subscription.
 */
export interface SubscribeChannelHandlerDeps {
    readonly eb: EventBusService | null
    readonly gw: GatewayService
    readonly glog: GLog
    readonly channelMode: 'chat' | 'task'
    readonly channelOutboundToolGuidance: (args: {
        mcpServer: string
        sender: string
        adapterBacked?: boolean
    }) => string
    readonly queue: GatewayInboundQueue
    readonly chatManager: GatewayChatManager
    // The only effect run through `runtime` is `eb.on(...)` (and its
    // service-instance handler gen), all typed `R = never`.
    readonly runtime: ManagedRuntime.ManagedRuntime<never, never>
    readonly agentId: string
    readonly getStopped: () => boolean
    readonly incrementChatTurns: () => void
    /**
     * Adapters the channel router owns (`withChannels({ routes })`). The router has already
     * decided access, metered and started the run for their messages, so this legacy subscriber
     * must not start a second one. Default: none.
     */
    readonly routerOwnedAdapterIds?: ReadonlySet<string>
}

/**
 * Adapter ids the channel router owns: every adapter when `routes` is set (the router replaces the
 * legacy trigger path for the whole config), none otherwise.
 */
export const routerOwnedAdapterIds = (
    cfg: { readonly routes?: readonly unknown[]; readonly adapters: readonly object[] } | undefined
): ReadonlySet<string> =>
    new Set(
        cfg?.routes?.length
            ? cfg.adapters.flatMap((a) =>
                  'id' in a && typeof a.id === 'string' ? [a.id] : []
              )
            : []
    )

/**
 * Subscribe to ChannelMessageReceived events on the EventBus and
 * dispatch each through the gateway. Returns a no-op unsub if
 * `eb` is null or subscription failed.
 */
export const subscribeChannelHandler = async (
    deps: SubscribeChannelHandlerDeps
): Promise<() => void> => {
    const {
        eb,
        gw,
        glog,
        channelMode,
        channelOutboundToolGuidance,
        queue,
        chatManager,
        runtime,
        agentId,
        getStopped,
        incrementChatTurns,
        routerOwnedAdapterIds: routerOwned = new Set<string>(),
    } = deps

    if (!eb) return () => {}

    // Dedup guard: suppress the same delivery arriving twice (e.g., agent reply echo arriving as
    // syncMessage before the MCP-level filter). Keyed by delivery identity, never message text alone.
    const dedup = Effect.runSync(makeDeliveryDedup(30_000))

    try {
        const unsub = await runtime.runPromise(
            eb.on('ChannelMessageReceived', (event) =>
                Effect.gen(function* () {
                    if (getStopped()) return

                    // Single consumer: the router owns its adapters' messages end to end.
                    if (
                        event.adapterId !== undefined &&
                        routerOwned.has(event.adapterId)
                    ) {
                        glog(
                            'debug',
                            `channel → ${event.adapterId} is router-owned; legacy handler skipped`
                        )
                        return
                    }

                    // Dedup: skip a delivery we have already seen
                    if (yield* dedup.seen(deliveryKey(event))) {
                        glog(
                            'debug',
                            `channel → dedup skip from ${event.sender}`
                        )
                        return
                    }

                    // Declared outbound requirement: only when delivery is by an MCP send tool.
                    const outbound = outboundServerOf(
                        event.mcpServer,
                        event.adapterId !== undefined
                    )
                    const gwEvent = {
                        id: `ch-${Date.now()}-${Math.random()
                            .toString(36)
                            .slice(2, 8)}`,
                        source: 'channel' as const,
                        timestamp: new Date(event.timestamp),
                        agentId,
                        payload: {
                            sender: event.sender,
                            message: event.message,
                        },
                        priority: 'normal' as const,
                        metadata: {
                            platform: event.platform,
                            sender: event.sender,
                            groupId: event.groupId,
                            mcpServer: event.mcpServer,
                            ...(outbound !== undefined
                                ? { outboundServer: outbound }
                                : {}),
                        },
                    }

                    const channelDecision = yield* gw.processEvent(gwEvent)

                    const mcpServer = String(event.mcpServer ?? '').trim()
                    // A native adapter exposes no MCP send tool; only MCP channels get that guidance.
                    const adapterBacked = event.adapterId !== undefined
                    const taskInstruction = [
                        `Respond to this ${event.platform} message from ${event.sender}: "${event.message}".`,
                        channelOutboundToolGuidance({
                            mcpServer,
                            sender: String(event.sender ?? ''),
                            adapterBacked,
                        }),
                    ]
                        .filter((p) => p !== '')
                        .join(' ')
                    // Chat turns submit their run to the queue themselves
                    // (chatManager -> executeEvent), so this resolves per turn.
                    const runChatTurn = async () => {
                        await chatManager.handleMessage(
                            event.sender,
                            event.message,
                            event.platform ?? 'unknown',
                            mcpServer,
                            gwEvent,
                            adapterBacked
                        )
                        incrementChatTurns()
                    }

                    if (channelDecision.action === 'execute') {
                        glog(
                            'info',
                            `channel → ${event.platform} message from ${event.sender}`,
                            {
                                message: event.message.slice(0, 80),
                                mode: channelMode,
                            }
                        )
                        if (channelMode === 'task') {
                            queue.enqueue(gwEvent, 'channel', taskInstruction)
                        } else {
                            yield* Effect.promise(runChatTurn)
                        }
                    } else if (channelDecision.action === 'queue') {
                        yield* Effect.promise(() =>
                            queue.defer(
                                gwEvent,
                                'channel',
                                channelMode === 'task' ? taskInstruction : event.message,
                                channelDecision.reason,
                                channelMode === 'chat' ? runChatTurn : undefined
                            )
                        )
                    } else {
                        glog(
                            'debug',
                            `channel → ${channelDecision.action} from ${event.sender}`,
                            {
                                reason:
                                    'reason' in channelDecision
                                        ? channelDecision.reason
                                        : undefined,
                            }
                        )
                    }
                })
            )
        )
        return () => {
            try {
                unsub()
            } catch {}
        }
    } catch {
        /* EventBus subscription failed — no channel routing */
        return () => {}
    }
}

/**
 * Dependencies for assembling the GatewayHandle returned by start().
 */
export interface BuildGatewayHandleDeps {
    readonly setStopped: (v: boolean) => void
    /** Close the gateway's resource scope (timer, subscription, router, ingress, chat manager). */
    readonly closeResources: () => Promise<void>
    readonly resolveStop: (summary: GatewaySummary) => void
    readonly stopPromise: Promise<GatewaySummary>
    readonly getCounters: () => {
        heartbeatsFired: number
        totalRuns: number
        cronChecks: number
        chatTurns: number
    }
}

/**
 * Build the GatewayHandle. Stop() sets stopped=true, closes the resource scope (cleanups run
 * newest first; a resource still being acquired is torn down as it lands), then assembles the
 * summary and resolves `done`.
 */
export const buildGatewayHandle = (
    deps: BuildGatewayHandleDeps
): GatewayHandle => {
    const { setStopped, closeResources, resolveStop, stopPromise, getCounters } =
        deps

    return {
        stop: async () => {
            setStopped(true)
            await closeResources()
            const summary: GatewaySummary = getCounters()
            resolveStop(summary)
            return summary
        },
        done: stopPromise,
    }
}
