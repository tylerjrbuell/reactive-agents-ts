/**
 * Gateway executeEvent helper.
 *
 * Runs a single gateway event (from heartbeat/cron/channel) through
 * the agent: builds a Task, runs it via ExecutionEngine, captures
 * tokens used, publishes ProactiveActionInitiated/Completed events,
 * and updates gateway counters.
 *
 * Not concurrency-guarded: serialization is owned by the gateway inbound
 * queue (gateway-inbound-queue.ts), which runs events one at a time in order.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, Schema, type Context, type ManagedRuntime } from 'effect'
import type { AgentEvent, RunOrigin, Task, TaskResult } from '@reactive-agents/core'
import { generateTaskId, AgentId, rootContext } from '@reactive-agents/core'
import { startRun } from '../engine/start-run.js'
import type { TaskError } from '@reactive-agents/core'
import type { GatewayService as GatewayServiceTag } from '@reactive-agents/gateway'
import type { RuntimeErrors } from '../errors.js'
import { errorMessage } from '@reactive-agents/core'
import type { AgentResultMetadata } from '../builder/types.js'
import type { GLog } from './gateway-bootstrap.js'
import { ORIGIN_CONTEXT_KEY } from '../chat/todo-seed.js'
import { OUTBOUND_SERVER_CONTEXT_KEY } from './gateway-outbound-requirement.js'

type GatewayService = Context.Tag.Service<typeof GatewayServiceTag>

/**
 * Minimal slice of ExecutionEngine used by executeEvent.
 *
 * Mirrors the structural shape of `ReactiveAgent`'s private engine field
 * so DTS emit stays portable — using the `ExecutionEngine` Tag class
 * here triggers unresolvable type-id references in the dts build.
 */
export interface ExecuteEventEngine {
    readonly execute: (
        task: Task
    ) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>
}

export interface ExecuteEventDeps {
    readonly publish: (event: AgentEvent) => Promise<void>
    readonly glog: GLog
    readonly engine: ExecuteEventEngine
    // The effects this module runs through `runtime` require nothing
    // (`engine.execute`'s seam type and `GatewayService.updateTokensUsed`
    // are both `R = never`), so the precise runtime view is `never`.
    readonly runtime: ManagedRuntime.ManagedRuntime<never, never>
    readonly gw: GatewayService
    readonly agentId: string
    readonly persistMemory: boolean
    readonly incrementTotalRuns: () => void
}

/** Spread-ready `{ outboundServer }` from the event metadata the channel driver stamped; `{}` otherwise. */
const outboundServerCarry = (event: unknown): Record<string, string> => {
    const meta = (event as { metadata?: { outboundServer?: unknown } } | null | undefined)?.metadata
    const server = meta?.outboundServer
    return typeof server === 'string' && server !== '' ? { [OUTBOUND_SERVER_CONTEXT_KEY]: server } : {}
}

/** Run origin for a gateway event source: timers are `scheduled`, everything else `gateway`. */
export const gatewayRunOrigin = (source: string): RunOrigin =>
    source === 'heartbeat' || source === 'cron' ? 'scheduled' : 'gateway'

/**
 * Build the gateway executeEvent helper. Returns an async function that
 * runs an event through the agent and reports the resulting output (or
 * undefined on failure / skipped concurrent run).
 */
export const makeExecuteEvent = (
    deps: ExecuteEventDeps
): (
    event: unknown,
    source: string,
    instruction: string
) => Promise<string | undefined> => {
    return async (
        _event: unknown,
        source: string,
        instruction: string
    ): Promise<string | undefined> => {
        await deps.publish({
            _tag: 'ProactiveActionInitiated',
            agentId: deps.agentId,
            source,
            taskDescription: instruction,
            timestamp: Date.now(),
        } as AgentEvent)
        const runStart = Date.now()
        try {
            // Default: unique agentId per gateway execution (no cross-tick memory).
            // With persistMemoryAcrossRuns, reuse stable id so memory spans heartbeats/crons.
            const runAgentId = deps.persistMemory
                ? deps.agentId
                : `${deps.agentId}-${source}-${Date.now()}`
            const task: Task = {
                id: generateTaskId(),
                agentId: Schema.decodeSync(AgentId)(runAgentId),
                type: 'query' as const,
                input: { question: instruction },
                priority: 'medium' as const,
                status: 'pending' as const,
                // Origin: timer-driven sources (heartbeat/cron) are `scheduled`;
                // every other gateway source (channel, webhook, ...) is `gateway`.
                metadata: { tags: [], context: { [ORIGIN_CONTEXT_KEY]: gatewayRunOrigin(source), ...outboundServerCarry(_event) } },
                createdAt: new Date(),
            }
            // The run's root entry (engine/start-run.ts).
            const taskResult: TaskResult = await deps.runtime.runPromise(
                deps.engine
                    .execute(task)
                    .pipe(
                        startRun({ context: rootContext(String(task.id), runAgentId) }),
                        Effect.mapError(
                            (e: unknown) =>
                                new Error(
                                    e !== null &&
                                    typeof e === 'object' &&
                                    'message' in e
                                        ? String(
                                              (e as { message: unknown })
                                                  .message
                                          )
                                        : String(e)
                                )
                        )
                    ) as Effect.Effect<TaskResult, Error>
            )
            const result = {
                output: String(taskResult.output ?? ''),
                success: taskResult.success,
                metadata: taskResult.metadata as AgentResultMetadata,
            }
            deps.incrementTotalRuns()
            const tokensUsed = result.metadata?.tokensUsed ?? 0
            const durationMs = Date.now() - runStart
            if (tokensUsed) {
                await deps.runtime.runPromise(
                    deps.gw.updateTokensUsed(tokensUsed)
                )
            }
            deps.glog(
                'info',
                `${source} completed (${durationMs}ms, ${tokensUsed} tokens)`
            )
            await deps.publish({
                _tag: 'ProactiveActionCompleted',
                agentId: deps.agentId,
                source,
                success: true,
                tokensUsed,
                durationMs,
                timestamp: Date.now(),
            } as AgentEvent)
            // A failed run's text (reasoning, an abstention note) is not a reply: `undefined` is
            // this function's "the run failed" signal, so callers never mistake it for output.
            return result.success ? result.output : undefined
        } catch (err) {
            const durationMs = Date.now() - runStart
            deps.glog(
                'warn',
                `${source} failed (${durationMs}ms): ${errorMessage(err)}`
            )
            await deps.publish({
                _tag: 'ProactiveActionCompleted',
                agentId: deps.agentId,
                source,
                success: false,
                tokensUsed: 0,
                durationMs,
                timestamp: Date.now(),
            } as AgentEvent)
            return undefined
        }
    }
}
