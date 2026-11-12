/**
 * Gateway inbound queue.
 *
 * Replaces "drop on overlap" (audit G3), "queue decisions go nowhere" (G2) and
 * "cron work runs inline in the tick" (G5). Two bounded FIFO lists:
 *
 *  - `ready`: events cleared to run. One worker drains it strictly in order,
 *    one agent run at a time, so an event that arrives while the agent is busy
 *    waits instead of vanishing.
 *  - `deferred`: events the policy engine answered `queue` for (rate limit,
 *    token budget). They are re-evaluated once a limit window has rolled and
 *    move to `ready` when the policy now says `execute`.
 *
 * Both lists share one capacity and overflow policy. Every enqueue-that-waits,
 * deferral and drop is published as a `ProactiveActionSuppressed` event whose
 * `policy` is `inbound-queue:<queued|deferred|dropped>`; a run that proceeds
 * emits the usual `ProactiveActionInitiated/Completed` pair (execute-event.ts).
 *
 * Independent of `@reactive-agents/gateway`: it needs only `reevaluate` (the
 * policy engine) and `windowStamp` (rolls when a limit window rolls).
 */

import type { AgentEvent } from '@reactive-agents/core'
import type { GLog } from './gateway-bootstrap.js'

/** What to discard when a full queue receives another event. */
export type InboundQueueOverflow = 'drop-oldest' | 'drop-newest'

/** Default maximum waiting events per list. */
export const DEFAULT_INBOUND_QUEUE_CAPACITY = 100

/** Serializable view of a waiting event, handed to the `persist` hook. */
export interface QueuedEventRecord {
    readonly id: string
    readonly source: string
    readonly instruction: string
    readonly enqueuedAt: number
    readonly state: 'ready' | 'deferred'
}

/** Subset of a policy decision the queue needs. */
export type InboundQueueDecision =
    | { readonly action: 'execute' }
    | { readonly action: 'queue' }
    | { readonly action: string }

/** Final disposition of one queued event. */
export type InboundQueueSettled =
    | { readonly outcome: 'ran'; readonly event: unknown; readonly source: string; readonly output: string | undefined }
    | { readonly outcome: 'skipped'; readonly event: unknown; readonly source: string; readonly reason: string }

export interface GatewayInboundQueueDeps {
    /** The raw run (one agent execution). Must not reject. */
    readonly run: (
        event: unknown,
        source: string,
        instruction: string
    ) => Promise<string | undefined>
    readonly publish: (event: AgentEvent) => Promise<void>
    readonly glog: GLog
    readonly agentId: string
    readonly getStopped: () => boolean
    readonly capacity?: number
    readonly overflow?: InboundQueueOverflow
    /** Re-run the policy engine for a deferred event. */
    readonly reevaluate: (event: unknown) => Promise<InboundQueueDecision>
    /** Opaque value that changes when a gateway limit window rolls. */
    readonly windowStamp: () => Promise<string>
    /**
     * Called once per event when its fate is known: it ran (`output` undefined means the run
     * failed), or it was dropped/skipped without running. Used to report schedule outcomes.
     */
    readonly onSettled?: (settled: InboundQueueSettled) => Promise<void>
    /** Persistence hook: called with the waiting set after every change. */
    readonly persist?: (pending: readonly QueuedEventRecord[]) => void | Promise<void>
}

export interface GatewayInboundQueue {
    /** Run in order and resolve with the output (undefined if failed or dropped). */
    readonly submit: (
        event: unknown,
        source: string,
        instruction: string
    ) => Promise<string | undefined>
    /** Fire-and-forget `submit`: callers (the tick) never wait on the run. */
    readonly enqueue: (event: unknown, source: string, instruction: string) => void
    /** Hold an event the policy answered `queue` for until a window rolls. */
    readonly defer: (
        event: unknown,
        source: string,
        instruction: string,
        reason: string,
        /**
         * Called instead of queueing a run when the policy clears the event on
         * retry (chat mode re-enters its own turn path, which submits itself).
         */
        release?: () => Promise<void>
    ) => Promise<void>
    /** Report an event the policy refused (never queued): fires `onSettled` as skipped. */
    readonly skip: (event: unknown, source: string, reason: string) => Promise<void>
    /** Re-evaluate deferred events if a window rolled since they were held. */
    readonly retryDeferred: () => Promise<void>
    readonly depth: () => { readonly ready: number; readonly deferred: number }
    /** Resolves once the ready list is empty and no run is in flight. */
    readonly idle: () => Promise<void>
}

interface Job {
    readonly id: string
    readonly event: unknown
    readonly source: string
    readonly instruction: string
    readonly enqueuedAt: number
    readonly settle: (output: string | undefined) => void
    /** Window stamp when deferred (deferred list only). */
    stamp?: string
    readonly release?: () => Promise<void>
}

const eventIdOf = (event: unknown, fallback: string): string =>
    typeof event === 'object' &&
    event !== null &&
    'id' in event &&
    typeof (event as { id: unknown }).id === 'string'
        ? (event as { id: string }).id
        : fallback

/** Build the inbound queue and its single worker. */
export const makeGatewayInboundQueue = (
    deps: GatewayInboundQueueDeps
): GatewayInboundQueue => {
    const capacity = Math.max(1, Math.floor(deps.capacity ?? DEFAULT_INBOUND_QUEUE_CAPACITY))
    const overflow: InboundQueueOverflow = deps.overflow ?? 'drop-oldest'
    const ready: Job[] = []
    const deferred: Job[] = []
    let draining: Promise<void> | null = null
    let seq = 0

    const suppress = (job: Job, kind: 'queued' | 'deferred' | 'dropped', reason: string) =>
        deps.publish({
            _tag: 'ProactiveActionSuppressed',
            agentId: deps.agentId,
            source: job.source,
            reason,
            policy: `inbound-queue:${kind}`,
            eventId: eventIdOf(job.event, job.id),
            timestamp: Date.now(),
        } as AgentEvent)

    const persist = async (): Promise<void> => {
        if (!deps.persist) return
        const rec = (j: Job, state: QueuedEventRecord['state']): QueuedEventRecord => ({
            id: eventIdOf(j.event, j.id),
            source: j.source,
            instruction: j.instruction,
            enqueuedAt: j.enqueuedAt,
            state,
        })
        try {
            await deps.persist([
                ...ready.map((j) => rec(j, 'ready')),
                ...deferred.map((j) => rec(j, 'deferred')),
            ])
        } catch (err) {
            deps.glog('warn', `inbound-queue persist failed: ${String(err)}`)
        }
    }

    const settled = async (s: InboundQueueSettled): Promise<void> => {
        if (!deps.onSettled) return
        try {
            await deps.onSettled(s)
        } catch (err) {
            deps.glog('warn', `inbound-queue onSettled failed: ${String(err)}`)
        }
    }

    const drop = async (job: Job, why: string): Promise<void> => {
        deps.glog('warn', `${job.source} → dropped (${why})`)
        job.settle(undefined)
        await suppress(job, 'dropped', why)
        await settled({ outcome: 'skipped', event: job.event, source: job.source, reason: why })
    }

    /** Append respecting capacity/overflow. Mutates synchronously (keeps FIFO), then reports drops. */
    const append = (list: Job[], job: Job, listName: string): Promise<void> => {
        let victim: Job | undefined
        let why = ''
        if (list.length < capacity) {
            list.push(job)
        } else if (overflow === 'drop-newest') {
            victim = job
            why = `${listName} queue full (${capacity}), newest dropped`
        } else {
            victim = list.shift()
            why = `${listName} queue full (${capacity}), oldest dropped`
            list.push(job)
        }
        return victim ? drop(victim, why) : Promise.resolve()
    }

    const drain = async (): Promise<void> => {
        for (;;) {
            const job = ready.shift()
            if (!job) return
            if (deps.getStopped()) {
                await drop(job, 'gateway stopped')
                continue
            }
            let out: string | undefined
            try {
                out = await deps.run(job.event, job.source, job.instruction)
            } catch (err) {
                deps.glog('warn', `${job.source} run rejected: ${String(err)}`)
            }
            job.settle(out)
            await settled({ outcome: 'ran', event: job.event, source: job.source, output: out })
            await persist()
        }
    }

    const wake = (): void => {
        if (draining) return
        draining = drain().finally(() => {
            draining = null
            if (ready.length > 0) wake()
        })
    }

    const submit: GatewayInboundQueue['submit'] = (event, source, instruction) =>
        new Promise<string | undefined>((resolve) => {
            const job: Job = {
                id: `q-${Date.now()}-${++seq}`,
                event,
                source,
                instruction,
                enqueuedAt: Date.now(),
                settle: resolve,
            }
            const waiting = draining !== null || ready.length > 0
            void (async () => {
                await append(ready, job, 'ready')
                if (!ready.includes(job)) return
                if (waiting) {
                    deps.glog('debug', `${source} → queued behind ${ready.length - 1} event(s)`)
                    await suppress(job, 'queued', `agent busy; position ${ready.length}`)
                }
                await persist()
                wake()
            })()
        })

    return {
        submit,
        enqueue: (event, source, instruction) => {
            void submit(event, source, instruction)
        },
        defer: async (event, source, instruction, reason, release) => {
            const job: Job = {
                id: `d-${Date.now()}-${++seq}`,
                event,
                source,
                instruction,
                enqueuedAt: Date.now(),
                settle: () => {},
                stamp: await deps.windowStamp(),
                release,
            }
            await append(deferred, job, 'deferred')
            if (!deferred.includes(job)) return
            deps.glog('info', `${source} → deferred (${reason})`)
            await suppress(job, 'deferred', reason)
            await persist()
        },
        skip: (event, source, reason) =>
            settled({ outcome: 'skipped', event, source, reason }),
        retryDeferred: async () => {
            if (deferred.length === 0) return
            const stamp = await deps.windowStamp()
            if (deferred.every((j) => j.stamp === stamp)) return
            const batch = deferred.splice(0, deferred.length)
            for (const job of batch) {
                const decision = await deps.reevaluate(job.event)
                if (decision.action === 'execute') {
                    if (job.release) {
                        void job.release().catch((err) =>
                            deps.glog('warn', `${job.source} release failed: ${String(err)}`)
                        )
                    } else {
                        await append(ready, job, 'ready')
                    }
                } else if (decision.action === 'queue') {
                    job.stamp = stamp
                    await append(deferred, job, 'deferred')
                } else {
                    await drop(job, `policy answered ${decision.action} on retry`)
                }
            }
            await persist()
            wake()
        },
        depth: () => ({ ready: ready.length, deferred: deferred.length }),
        idle: async () => {
            while (draining || ready.length > 0) {
                await (draining ?? new Promise<void>((r) => setTimeout(r, 0)))
            }
        },
    }
}
