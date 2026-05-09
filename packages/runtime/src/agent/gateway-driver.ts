/**
 * Gateway loop driver.
 *
 * Subscribes to ChannelMessageReceived events for push-based
 * messaging (with sender:message dedup window), and builds the
 * GatewayHandle that the caller uses to stop the loop and read
 * the final summary.
 *
 * The stop() handler runs the full cleanup chain in order:
 * stopped=true → clearInterval → unsubChannel → channelAdaptersCleanup
 * → chatManager.dispose → assemble summary → resolveStop.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, type ManagedRuntime } from 'effect'
import type { GatewayChatManager } from '../gateway-chat.js'
import type {
    GatewayHandle,
    GatewaySummary,
} from '../builder/types.js'
import type { GLog } from './gateway-bootstrap.js'
import type { makeExecuteEvent } from './execute-event.js'

/**
 * Dependencies for the channel-message subscription.
 */
export interface SubscribeChannelHandlerDeps {
    readonly eb: unknown | null
    readonly gw: unknown
    readonly glog: GLog
    readonly channelMode: 'chat' | 'task'
    readonly channelOutboundToolGuidance: (args: {
        mcpServer: string
        sender: string
    }) => string
    readonly executeEvent: ReturnType<typeof makeExecuteEvent>
    readonly chatManager: GatewayChatManager
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly runtime: ManagedRuntime.ManagedRuntime<any, never>
    readonly agentId: string
    readonly getStopped: () => boolean
    readonly incrementChatTurns: () => void
}

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
        executeEvent,
        chatManager,
        runtime,
        agentId,
        getStopped,
        incrementChatTurns,
    } = deps

    if (!eb) return () => {}

    // Dedup guard: track recently processed messages to prevent feedback loops
    // (e.g., agent reply echo arriving as syncMessage before MCP-level filter)
    const recentMessageHashes = new Set<string>()
    const MESSAGE_DEDUP_TTL = 30_000 // 30s window

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ebAny = eb as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gwAny = gw as any

    try {
        const unsub = await runtime.runPromise(
            ebAny.on('ChannelMessageReceived', (event: any) =>
                Effect.gen(function* () {
                    if (getStopped()) return

                    // Dedup: skip if we've seen this exact sender+message recently
                    const msgHash = `${event.sender}:${event.message}`
                    if (recentMessageHashes.has(msgHash)) {
                        glog(
                            'debug',
                            `channel → dedup skip from ${event.sender}`
                        )
                        return
                    }
                    recentMessageHashes.add(msgHash)
                    setTimeout(
                        () => recentMessageHashes.delete(msgHash),
                        MESSAGE_DEDUP_TTL
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
                        },
                    }

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const channelDecision: any = yield* gwAny.processEvent(
                        gwEvent
                    )

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
                            const mcpServer = String(
                                event.mcpServer ?? ''
                            ).trim()
                            const instruction =
                                `Respond to this ${event.platform} message from ${event.sender}: "${event.message}". ` +
                                channelOutboundToolGuidance({
                                    mcpServer,
                                    sender: String(event.sender ?? ''),
                                })
                            yield* Effect.promise(() =>
                                executeEvent(
                                    gwEvent,
                                    'channel',
                                    instruction
                                )
                            )
                        } else {
                            yield* Effect.promise(() =>
                                chatManager.handleMessage(
                                    event.sender,
                                    event.message,
                                    event.platform ?? 'unknown',
                                    String(event.mcpServer ?? '').trim(),
                                    gwEvent
                                )
                            )
                            incrementChatTurns()
                        }
                    } else {
                        glog(
                            'debug',
                            `channel → ${channelDecision.action} from ${event.sender}`,
                            { reason: channelDecision.reason }
                        )
                    }
                })
            )
        )
        return () => {
            try {
                ;(unsub as () => void)()
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
    readonly getTimer: () => ReturnType<typeof setInterval> | null
    readonly getUnsubChannel: () => (() => void) | null
    readonly getChannelAdaptersCleanup: () =>
        | (() => Promise<void>)
        | null
    readonly getChatManager: () => GatewayChatManager | null
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
 * Build the GatewayHandle. Stop() runs the cleanup chain in order:
 * stopped=true → clearInterval → unsubChannel → channelAdaptersCleanup
 * → chatManager.dispose → assemble summary → resolveStop.
 */
export const buildGatewayHandle = (
    deps: BuildGatewayHandleDeps
): GatewayHandle => {
    const {
        setStopped,
        getTimer,
        getUnsubChannel,
        getChannelAdaptersCleanup,
        getChatManager,
        resolveStop,
        stopPromise,
        getCounters,
    } = deps

    return {
        stop: async () => {
            setStopped(true)
            const timer = getTimer()
            if (timer) clearInterval(timer)
            getUnsubChannel()?.()
            await getChannelAdaptersCleanup()?.()
            const chatManager = getChatManager()
            if (chatManager) await chatManager.dispose()
            const summary: GatewaySummary = getCounters()
            resolveStop(summary)
            return summary
        },
        done: stopPromise,
    }
}
