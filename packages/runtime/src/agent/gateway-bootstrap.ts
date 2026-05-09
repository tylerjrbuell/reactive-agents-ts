/**
 * Gateway loop bootstrap.
 *
 * Resolves Gateway + Scheduler services from the managed runtime,
 * optionally resolves EventBus + ObservabilityService for logging,
 * builds the routing log helper, and initializes channel adapters
 * (webhook/bot integrations) registered via .withChannels().
 *
 * Used by ReactiveAgent.start() before the main heartbeat/cron loop
 * begins. The returned bundle exposes the resolved services + the
 * log helper + cleanup so the loop body can dispatch events and
 * compose policies.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, type ManagedRuntime } from 'effect'
import type { AgentEvent } from '@reactive-agents/core'
import { generateTaskId } from '@reactive-agents/core'
import type { ChannelsConfig } from '@reactive-agents/channels'
import type { ChatReply } from '../chat.js'

export type GLog = (
    level: string,
    message: string,
    metadata?: Record<string, unknown>
) => void

/**
 * Minimal session shape needed by the channel adapter agentFactory.
 * Mirrors the AgentSession.chat() return signature without coupling to its full type.
 */
export interface ChannelSession {
    chat: (
        message: string
    ) => Promise<ChatReply>
}

/**
 * Builder hooks the bootstrap needs. Kept minimal so the module
 * doesn't reach into the full ReactiveAgent surface.
 */
export interface BootstrapDeps {
    readonly runtime: ManagedRuntime.ManagedRuntime<unknown, unknown>
    readonly channelsConfig: ChannelsConfig | undefined
    readonly gatewayIntervalMs: number
    /** Builds an AgentSession-like wrapper for channel adapter agentFactory. */
    readonly createSession: (sessionId: string) => {
        chat: (
            message: string
        ) => Promise<ChatReply>
    }
}

export interface GatewayBootstrapSuccess {
    readonly ok: true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly gw: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly sched: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly eb: any | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly obs: any | null
    readonly glog: GLog
    readonly channelAdaptersCleanup: (() => Promise<void>) | null
}

export interface GatewayBootstrapFailure {
    readonly ok: false
    readonly error: Error
}

export type GatewayBootstrapResult =
    | GatewayBootstrapSuccess
    | GatewayBootstrapFailure

/**
 * Resolve gateway + scheduler + (optional) eventbus/obs services and
 * initialize channel adapters. Returns a discriminated union so the
 * caller can propagate the gateway-not-configured error path with
 * byte-identical behavior.
 */
export const bootstrapGateway = async (
    deps: BootstrapDeps
): Promise<GatewayBootstrapResult> => {
    const { runtime, channelsConfig, gatewayIntervalMs, createSession } = deps

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let gw: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sched: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let eb: any = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let obs: any = null

    try {
        const services = await runtime.runPromise(
            Effect.gen(function* () {
                const gwMod = yield* Effect.promise(
                    () => import('@reactive-agents/gateway')
                )
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const g = yield* gwMod.GatewayService as any
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const s = yield* gwMod.SchedulerService as any
                return { gw: g, sched: s }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as Effect.Effect<any>
        )
        gw = services.gw
        sched = services.sched
    } catch {
        return {
            ok: false,
            error: new Error(
                'Gateway not configured. Call .withGateway() before .start()'
            ),
        }
    }

    // Resolve EventBus for observability (optional)
    try {
        eb = await runtime.runPromise(
            Effect.gen(function* () {
                const coreMod = yield* Effect.promise(
                    () => import('@reactive-agents/core')
                )
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return yield* coreMod.EventBus as any
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as Effect.Effect<any>
        )
    } catch {
        /* EventBus not in runtime — no observability */
    }

    // Resolve ObservabilityService for structured logging (optional)
    try {
        obs = await runtime.runPromise(
            Effect.gen(function* () {
                const obsMod = yield* Effect.promise(
                    () => import('@reactive-agents/observability')
                )
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return yield* obsMod.ObservabilityService as any
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as Effect.Effect<any>
        )
    } catch {
        /* ObservabilityService not in runtime — no logging */
    }

    // Gateway log helper — routes through ObservabilityService when available
    const glog: GLog = (level, message, metadata) => {
        if (!obs) return
        runtime
            .runPromise(
                obs.log(level, `◉ [gateway] ${message}`, metadata ?? {})
            )
            .catch(() => {})
    }

    glog('info', `started (interval=${gatewayIntervalMs}ms)`)

    let channelAdaptersCleanup: (() => Promise<void>) | null = null

    if (channelsConfig?.adapters && channelsConfig.adapters.length > 0) {
        try {
            const chMod = await import('@reactive-agents/channels')
            const triggers = new chMod.TriggerRegistry()
            for (const t of channelsConfig.triggers ?? []) {
                triggers.register(t)
            }
            if (channelsConfig.defaultAgent) {
                triggers.setDefaultAgent(channelsConfig.defaultAgent)
            }
            const sessions = new chMod.SessionBridge({
                agentFactory: async (agentConfig, sessionId) => {
                    const session = createSession(sessionId)
                    const prefixParts: string[] = []
                    if (agentConfig?.systemPrompt) {
                        prefixParts.push(agentConfig.systemPrompt)
                    }
                    if (agentConfig?.persona?.instructions) {
                        prefixParts.push(agentConfig.persona.instructions)
                    }
                    const prefix =
                        prefixParts.length > 0
                            ? `${prefixParts.join('\n\n')}\n\n---\n\n`
                            : ''
                    return {
                        chat: async (message: string) => {
                            const r = await session.chat(
                                `${prefix}${message}`
                            )
                            return {
                                message: r.message,
                                tokens: r.tokens,
                            }
                        },
                    }
                },
            })
            const channelSvc = new chMod.ChannelService({
                triggers,
                sessions,
                evaluatePolicy: (event) => gw.processEvent(event),
                taskId: () => generateTaskId(),
                eventBus:
                    eb !== null
                        ? {
                              publish: (e: AgentEvent) =>
                                  eb.publish(e) as Effect.Effect<
                                      void,
                                      never
                                  >,
                          }
                        : undefined,
            })
            for (const adapter of channelsConfig.adapters) {
                await Effect.runPromise(
                    channelSvc.registerAdapter(adapter)
                )
            }
            glog(
                'info',
                `channels: started ${channelsConfig.adapters.length} adapter(s)`
            )
            channelAdaptersCleanup = async () => {
                for (const adapter of channelsConfig.adapters) {
                    try {
                        await Effect.runPromise(adapter.disconnect())
                    } catch {
                        /* ignore */
                    }
                }
            }
        } catch (err) {
            glog(
                'error',
                `channels: failed to start — ${
                    err instanceof Error ? err.message : String(err)
                }`
            )
        }
    }

    return {
        ok: true,
        gw,
        sched,
        eb,
        obs,
        glog,
        channelAdaptersCleanup,
    }
}
