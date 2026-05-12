/**
 * Gateway executeEvent helper.
 *
 * Runs a single gateway event (from heartbeat/cron/channel) through
 * the agent: builds a Task, runs it via ExecutionEngine, captures
 * tokens used, publishes ProactiveActionInitiated/Completed events,
 * and updates gateway counters.
 *
 * Concurrency-guarded by isExecuting flag — overlapping calls are
 * skipped with a debug log. The flag is read/written via getter+setter
 * deps so the caller's mutable bool stays the source of truth.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, Schema, type Context, type ManagedRuntime } from 'effect'
import type { AgentEvent, Task, TaskResult } from '@reactive-agents/core'
import { generateTaskId, AgentId } from '@reactive-agents/core'
import type { TaskError } from '@reactive-agents/core'
import type { GatewayService as GatewayServiceTag } from '@reactive-agents/gateway'
import type { RuntimeErrors } from '../errors.js'
import type { AgentResultMetadata } from '../builder/types.js'
import type { GLog } from './gateway-bootstrap.js'

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly runtime: ManagedRuntime.ManagedRuntime<any, never>
    readonly gw: GatewayService
    readonly agentId: string
    readonly persistMemory: boolean
    readonly getIsExecuting: () => boolean
    readonly setIsExecuting: (v: boolean) => void
    readonly incrementTotalRuns: () => void
}

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
        if (deps.getIsExecuting()) {
            deps.glog(
                'debug',
                `${source} → skipped (another execution in progress)`
            )
            return
        }
        deps.setIsExecuting(true)
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
                metadata: { tags: [] },
                createdAt: new Date(),
            }
            const taskResult: TaskResult = await deps.runtime.runPromise(
                deps.engine
                    .execute(task)
                    .pipe(
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
            return result.output
        } catch (err) {
            const durationMs = Date.now() - runStart
            deps.glog(
                'warn',
                `${source} failed (${durationMs}ms): ${
                    err instanceof Error ? err.message : String(err)
                }`
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
        } finally {
            deps.setIsExecuting(false)
        }
    }
}
