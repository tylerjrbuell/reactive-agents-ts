/**
 * Gateway HTTP ingress wiring.
 *
 * Serves `GatewayConfig.port` + `webhooks` (and webhook-capable channel adapters, e.g. the
 * Telegram adapter in webhook mode) with `startGatewayIngress`, inside a `Scope` the gateway
 * run owns and closes on `stop()`. A verified webhook becomes a GatewayEvent, goes through
 * the policy engine, and enters the bounded inbound queue: the HTTP response only waits for
 * the enqueue, never for the agent run.
 */

import { Effect } from 'effect'
import type { GatewayConfig, GatewayEvent, IngressServer } from '@reactive-agents/gateway'
import { startScoped } from './start-scoped.js'
import type { GLog } from './gateway-bootstrap.js'
import type { GatewayInboundQueue } from './gateway-inbound-queue.js'

/** Gateway config slice the ingress serves. */
export interface GatewayIngressConfig {
    /** Listen port; the gateway default is 3000. */
    readonly port?: number
    readonly webhooks?: GatewayConfig['webhooks']
    /**
     * Which webhook-capable channel adapters the ingress serves. Omitted serves all;
     * `false` serves none (host mounts them itself); a list serves only those adapter ids.
     */
    readonly channels?: false | readonly string[]
}

const DEFAULT_GATEWAY_PORT = 3000

/** A channel adapter that accepts inbound updates over HTTP. */
interface WebhookCapableAdapter {
    readonly id: string
    readonly handleWebhook: (req: {
        readonly body: string
        readonly headers: Readonly<Record<string, string>>
    }) => Effect.Effect<void, { readonly kind: string; readonly message: string }>
}

const hasWebhook = (a: unknown): a is WebhookCapableAdapter =>
    typeof a === 'object' &&
    a !== null &&
    typeof (a as { handleWebhook?: unknown }).handleWebhook === 'function' &&
    typeof (a as { id?: unknown }).id === 'string'

/** The webhook payload's `metadata.instruction` when it is a string; anything else is ignored. */
export const instructionOf = (event: GatewayEvent): string | undefined => {
    const instruction = event.metadata['instruction']
    return typeof instruction === 'string' ? instruction : undefined
}

export interface StartIngressDeps {
    readonly config: GatewayIngressConfig
    readonly adapters: readonly unknown[]
    readonly queue: GatewayInboundQueue
    readonly processEvent: (event: GatewayEvent) => Promise<
        | { readonly action: 'execute'; readonly taskDescription: string }
        | { readonly action: 'queue'; readonly reason: string }
        | { readonly action: string }
    >
    readonly glog: GLog
}

/**
 * Start ingress if anything is configured to serve. Returns a stop function
 * (closes the server scope) or null when nothing is served or startup failed.
 */
export const startRuntimeIngress = async (
    deps: StartIngressDeps
): Promise<{ readonly server: IngressServer; readonly stop: () => Promise<void> } | null> => {
    const { startGatewayIngress } = await import('@reactive-agents/gateway')
    const { channels, ...gatewayConfig } = deps.config
    const channelRoutes = deps.adapters
        .filter(hasWebhook)
        .filter((a) => channels === undefined || (channels !== false && channels.includes(a.id)))
        .map((adapter) => ({
        path: `/channels/${adapter.id}`,
        id: adapter.id,
        handle: (req: { body: string; headers: Record<string, string> }) =>
            adapter.handleWebhook(req),
    }))
    const onEvent = (event: GatewayEvent): Effect.Effect<void> =>
        Effect.promise(async () => {
            const decision = await deps.processEvent(event)
            const instruction = instructionOf(event)
            if (decision.action === 'execute') {
                deps.queue.enqueue(
                    event,
                    event.source,
                    instruction ?? (decision as { taskDescription: string }).taskDescription
                )
            } else if (decision.action === 'queue') {
                await deps.queue.defer(
                    event,
                    event.source,
                    instruction ?? `${event.source} event ${event.id}`,
                    (decision as { reason: string }).reason
                )
            } else {
                deps.glog('debug', `${event.source} → ${decision.action} (ingress)`)
            }
        })
    try {
        const { value: server, stop } = await startScoped(
            startGatewayIngress({ ...gatewayConfig, port: gatewayConfig.port ?? DEFAULT_GATEWAY_PORT }, { onEvent, channelRoutes })
        )
        if (!server) {
            await stop()
            return null
        }
        deps.glog('info', `ingress listening on ${server.url}`)
        return { server, stop }
    } catch (err) {
        deps.glog('warn', `ingress failed to start on port ${deps.config.port ?? DEFAULT_GATEWAY_PORT}: ${String(err)}`)
        return null
    }
}
