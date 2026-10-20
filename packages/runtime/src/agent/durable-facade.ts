/**
 * Durable-run facade — the Phase C / Phase D / Task 10 durable-run surface of
 * `ReactiveAgent` moved out of `reactive-agent.ts` (#217 / HS-247):
 * `resumeRun`, `fork`, `listRuns`, `approveRun`, `denyRun`,
 * `decideAndResumeRun`, `listPendingApprovals`, `getDurableInfo`,
 * `listPendingInteractions`, `respondToInteraction`.
 *
 * The public class methods are thin one-line delegates that construct the
 * {@link DurableFacadeDeps} object per call and forward here. Bodies were
 * moved verbatim. `runDurable` itself STAYED in `reactive-agent.ts` because
 * `run()` shares it — the facade receives it wired through deps.
 */

import { Effect } from 'effect'
import { ManagedRuntime } from 'effect'
import { ResumeStateRef } from '@reactive-agents/core'
import { join } from 'node:path'
import {
    loadResumePayload,
    loadForkPayload,
    listDurableRuns,
    markRunStatus,
    decideApprovalRecord,
    getPendingApprovalAt,
    decideInteractionRecord,
    getPendingInteractionAt,
} from '../engine/durable-resume.js'
import { unwrapErrorWithSuggestion } from '../errors.js'
import type { AgentResult } from '../builder/types.js'
import type { RunRecord, RunStatus } from '../services/run-store.js'

/** Parse stored approval args JSON, falling back to the raw string on malformed input. (Local copy of reactive-agent.ts's helper — needed by both this module and agent/run-task-effect.ts for #217.) */
const safeParseJson = (s: string): unknown => {
    try {
        return JSON.parse(s)
    } catch {
        return s
    }
}

/**
 * Shape of `ReactiveAgent.runDurable`'s params — mirrors the class's inline
 * parameter type verbatim (the method itself stayed in `reactive-agent.ts`
 * because `run()` shares it).
 */
export interface RunDurableParams {
    readonly input: string
    readonly taskId?: string
    readonly runId: string
    readonly task: string
    readonly resume?: {
        readonly stateJson: string
        readonly decision?: { gateId: string; status: 'approved' | 'denied'; reason?: string }
        readonly interaction?: { interactionId: string; valueJson: string }
    }
    /** Per-run model override (Arc 1 Task 6) — seeded via `ModelOverrideRef`. */
    readonly modelOverride?: string
    /** Fork lineage (Arc 1 Task 6) — stamped onto the created run row. */
    readonly forkedFrom?: string
    readonly forkedAtIteration?: number
}

/** Explicit dependency surface — exactly the `ReactiveAgent` fields/methods the moved methods read. */
export interface DurableFacadeDeps {
    readonly durableResume?: { readonly dir: string; readonly configHash: string }
    readonly agentId: string
    readonly runtime: ManagedRuntime.ManagedRuntime<any, never>
    readonly buildRunTaskEffect: (input: string, options?: {
        readonly taskId?: string
        readonly durableRunId?: string
        readonly forkedFrom?: string
    }) => Effect.Effect<AgentResult, Error>
    readonly runDurable: (params: RunDurableParams) => Promise<AgentResult>
}

/**
 * Build the durable-run facade object — moved verbatim from
 * `reactive-agent.ts` internals.
 */
export const makeDurableFacade = (deps: DurableFacadeDeps) => {
    const facade = {
        /**
         * Resume a crashed or paused durable run from its last checkpoint (Phase C).
         *
         * Loads the highest-iteration checkpoint persisted by `.withDurableRuns()`,
         * validates that this agent's config still matches the one the run was
         * captured under (config-hash guard), seeds the restored `KernelState` via
         * `ResumeStateRef`, and continues the run to completion. Completed tools are
         * NOT re-executed — their results live in the restored steps/messages.
         *
         * @param runId - The run id reported when the original run was created.
         * @throws Error if the agent was not built with `.withDurableRuns()`.
         * @throws DurableRunNotFoundError if the run / checkpoint is unknown.
         * @throws DurableConfigMismatchError if the agent config changed since capture.
         *
         * Note: resumed results return the base `AgentResult`; typed structured `object` carry is not threaded through resume yet.
         *
         * Named `resumeRun` (not `resume`) to avoid colliding with the in-process
         * pause/resume control verb `resume()`.
         *
         * Moved verbatim (body + this JSDoc) from `ReactiveAgent.resumeRun` for #217;
         * the class method on `ReactiveAgent` is now a one-line delegate.
         */
        async resumeRun(runId: string): Promise<AgentResult> {
            if (!deps.durableResume) {
                throw new Error(
                    'resumeRun() requires .withDurableRuns() — this agent has no durable run store.',
                )
            }
            const { dir, configHash } = deps.durableResume
            const dbPath = join(dir, 'runs.db')

            // 1. Load + guard the checkpoint on the default runtime (RunStore is
            //    self-contained; no agent services required).
            const payload = await Effect.runPromise(
                loadResumePayload({ runId, dbPath, currentConfigHash: configHash }),
            )

            // 2. Re-run to completion with the restored state seeded via FiberRef.
            //    reasoning-think reads ResumeStateRef, deserializes, and forwards it
            //    as KernelInput.resumeState so the runner continues mid-stream.
            const pipeline = deps.buildRunTaskEffect(payload.run.task, { taskId: runId })
            try {
                const result = await deps.runtime.runPromise(
                    Effect.locally(pipeline, ResumeStateRef, payload.stateJson),
                )
                await Effect.runPromise(
                    markRunStatus({ dbPath, runId, status: 'completed' }),
                )
                return result
            } catch (e) {
                await Effect.runPromise(
                    markRunStatus({ dbPath, runId, status: 'failed' }),
                )
                throw unwrapErrorWithSuggestion(e)
            }
        },

        /**
         * Fork a NEW run from any checkpoint of a prior run (Arc 1 Task 6) —
         * a counterfactual restart, NEVER "time travel". Every LLM call made
         * after the fork point is a live, fresh call against the current
         * provider; nothing is replayed.
         *
         * Loads the checkpoint at-or-below `opts.at` (defaults to the source
         * run's latest checkpoint, like `resumeRun`) from `runId`'s history via
         * `loadForkPayload` — deliberately WITHOUT `resumeRun`'s config-hash
         * guard, since forking under a different config (or a different
         * `opts.model`) is the whole point, not an error. Creates a BRAND NEW
         * run row (`${runId}-fork-<8 hex chars>`) stamped with THIS agent's
         * current config hash and `{ forkedFrom, forkedAtIteration }` provenance,
         * seeds the restored `KernelState`, and runs to completion — mirroring
         * `runDurable`'s create-row + checkpoint + resume-seed pipeline used by
         * `run()`/`approveRun`/`denyRun`.
         *
         * v1 scope: same agent instance/tools/system prompt as the source run.
         * `opts.task` overrides the re-run input (defaults to the source run's
         * original task — reusing it verbatim only makes sense against a fresh
         * test scenario/replay; real providers regenerate live). `opts.model`
         * overrides the model for this run only (see `ModelOverrideRef`); it has
         * no effect when `.withModelRouting()` is also enabled, since that phase
         * recomputes the selected model independently (known v1 gap).
         *
         * Caveat inherited from Task 4: a run that is currently paused
         * (`awaiting-approval` / `awaiting-interaction`) does not flush its
         * in-flight checkpoint write, so forking it may see a stale or absent
         * checkpoint row.
         *
         * @param runId - The SOURCE run id to fork from.
         * @throws Error if the agent was not built with `.withDurableRuns()`.
         * @throws DurableRunNotFoundError if the source run / a qualifying checkpoint is unknown.
         *
         * Moved verbatim (body + this JSDoc) from `ReactiveAgent.fork` for #217;
         * the class method on `ReactiveAgent` is now a one-line delegate.
         */
        async fork(
            runId: string,
            opts?: { at?: number; model?: string; task?: string },
        ): Promise<AgentResult> {
            if (!deps.durableResume) {
                throw new Error(
                    'fork() requires .withDurableRuns() — this agent has no durable run store.',
                )
            }
            const { dir } = deps.durableResume
            const dbPath = join(dir, 'runs.db')

            // 1. Load the source checkpoint — any iteration, no config-hash guard.
            const payload = await Effect.runPromise(
                loadForkPayload({ runId, dbPath, at: opts?.at }),
            )

            // 2. Fresh identity for the forked run — distinct from the source by
            //    construction, and 8 hex chars (32 bits) of suffix entropy make
            //    two forks of the SAME source colliding with each other
            //    astronomically unlikely (4 hex chars/16 bits was too narrow:
            //    `INSERT OR REPLACE` on a collision would clobber the earlier
            //    fork's run row while its `run_checkpoints` rows stayed behind
            //    under the reused runId — a stale-state rehydration hazard).
            const forkedRunId = `${runId}-fork-${crypto.randomUUID().slice(0, 8)}`
            const task = opts?.task ?? payload.run.task

            // 3. Create the new row (this agent's CURRENT configHash) + seed the
            //    restored state + run to completion, same rail as run()/approveRun.
            return deps.runDurable({
                input: task,
                taskId: forkedRunId,
                runId: forkedRunId,
                task,
                resume: { stateJson: payload.stateJson },
                ...(opts?.model !== undefined ? { modelOverride: opts.model } : {}),
                forkedFrom: runId,
                forkedAtIteration: payload.iteration,
            })
        },

        /**
         * List persisted durable runs (newest-updated first), optionally filtered by
         * lifecycle status. Requires `.withDurableRuns()`. Moved verbatim from
         * `ReactiveAgent.listRuns`.
         */
        async listRuns(filter?: { status?: RunStatus; userId?: string }): Promise<readonly RunRecord[]> {
            if (!deps.durableResume) {
                throw new Error(
                    'listRuns() requires .withDurableRuns() — this agent has no durable run store.',
                )
            }
            const dbPath = join(deps.durableResume.dir, 'runs.db')
            return Effect.runPromise(
                listDurableRuns({ dbPath, status: filter?.status, userId: filter?.userId }),
            )
        },

        /**
         * Durable HITL (Phase D): approve a paused run and resume it to
         * completion (moved verbatim from `ReactiveAgent.approveRun`).
         */
        async approveRun(runId: string, opts?: { reason?: string }): Promise<AgentResult> {
            return facade.decideAndResumeRun(runId, { status: 'approved', reason: opts?.reason })
        },

        /**
         * Durable HITL (Phase D): deny a run's paused action and resume it to
         * completion (moved verbatim from `ReactiveAgent.denyRun`).
         */
        async denyRun(runId: string, reason: string): Promise<AgentResult> {
            return facade.decideAndResumeRun(runId, { status: 'denied', reason })
        },

        /** Record an approve/deny decision then resume the run from its checkpoint. (Moved verbatim — formerly private `decideAndResumeRun`.) */
        async decideAndResumeRun(
            runId: string,
            decision: { status: 'approved' | 'denied'; reason?: string },
        ): Promise<AgentResult> {
            if (!deps.durableResume) {
                throw new Error(
                    'approveRun()/denyRun() requires .withDurableRuns() — this agent has no durable run store.',
                )
            }
            const { dir, configHash } = deps.durableResume
            const dbPath = join(dir, 'runs.db')

            // 1. Record the human decision (fails ApprovalStateError if not pending).
            const { gateId } = await Effect.runPromise(
                decideApprovalRecord({ dbPath, runId, status: decision.status, reason: decision.reason }),
            )

            // 2. Load + guard the paused checkpoint.
            const payload = await Effect.runPromise(
                loadResumePayload({ runId, dbPath, currentConfigHash: configHash }),
            )

            // 3. Resume through the durable wrapper (same as run()), seeding the restored
            //    state + the decision. Using runDurable means a re-pause on resume is
            //    persisted + surfaced (multi-gate), and completion flips to `completed`.
            return deps.runDurable({
                input: payload.run.task,
                taskId: runId,
                runId,
                task: payload.run.task,
                resume: {
                    stateJson: payload.stateJson,
                    decision: {
                        gateId,
                        status: decision.status,
                        ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
                    },
                },
            })
        },

        /**
         * Durable HITL (Phase D): list runs paused awaiting a human decision, with the
         * pending action (tool + args) for each. Requires `.withDurableRuns()`.
         * Moved verbatim from `ReactiveAgent.listPendingApprovals`.
         */
        async listPendingApprovals(): Promise<
            readonly {
                runId: string
                gateId: string
                toolName: string
                args: unknown
                task: string
                updatedAt: number
            }[]
        > {
            if (!deps.durableResume) {
                throw new Error('listPendingApprovals() requires .withDurableRuns().')
            }
            const dbPath = join(deps.durableResume.dir, 'runs.db')
            const runs = await Effect.runPromise(
                listDurableRuns({ dbPath, status: 'awaiting-approval' }),
            )
            const out: {
                runId: string
                gateId: string
                toolName: string
                args: unknown
                task: string
                updatedAt: number
            }[] = []
            for (const run of runs) {
                const pending = await Effect.runPromise(
                    getPendingApprovalAt({ dbPath, runId: run.runId }),
                )
                if (pending) {
                    out.push({
                        runId: run.runId,
                        gateId: pending.gateId,
                        toolName: pending.toolName,
                        args: safeParseJson(pending.argsJson),
                        task: run.task,
                        updatedAt: run.updatedAt,
                    })
                }
            }
            return out
        },

        /**
         * Agentic-UI interaction rail (Task 10): the durable store location + agent id
         * for this agent when built with `.withDurableRuns()`, else `undefined`.
         * Lets server adapters (Task 12) resolve the db path without reaching into
         * builder internals. Matches how `runDurable`/`listRuns` compute the db path.
         * Moved verbatim from `ReactiveAgent.getDurableInfo`.
         */
        getDurableInfo(): { dbPath: string; agentId: string } | undefined {
            if (!deps.durableResume) return undefined
            return {
                dbPath: join(deps.durableResume.dir, 'runs.db'),
                agentId: deps.agentId,
            }
        },

        /**
         * Agentic-UI interaction rail (Task 10): list runs paused awaiting a human
         * response to a `request_user_input`, with the pending interaction (kind +
         * prompt + parsed schema) for each. Requires `.withDurableRuns()`. Clone of
         * `listPendingApprovals`. Moved verbatim from
         * `ReactiveAgent.listPendingInteractions`.
         */
        async listPendingInteractions(): Promise<
            readonly {
                runId: string
                interactionId: string
                kind: string
                prompt: string
                schema: unknown
                task: string
                updatedAt: number
            }[]
        > {
            if (!deps.durableResume) {
                throw new Error('listPendingInteractions() requires .withDurableRuns().')
            }
            const dbPath = join(deps.durableResume.dir, 'runs.db')
            const runs = await Effect.runPromise(
                listDurableRuns({ dbPath, status: 'awaiting-interaction' }),
            )
            const out: {
                runId: string
                interactionId: string
                kind: string
                prompt: string
                schema: unknown
                task: string
                updatedAt: number
            }[] = []
            for (const run of runs) {
                const pending = await Effect.runPromise(
                    getPendingInteractionAt({ dbPath, runId: run.runId }),
                )
                if (pending) {
                    out.push({
                        runId: run.runId,
                        interactionId: pending.interactionId,
                        kind: pending.kind,
                        prompt: pending.prompt,
                        schema: safeParseJson(pending.schemaJson),
                        task: run.task,
                        updatedAt: run.updatedAt,
                    })
                }
            }
            return out
        },

        /**
         * Agentic-UI interaction rail (Task 10): record a human's response to a run
         * that paused for `request_user_input` and resume it to completion. Callable
         * from ANY process (the response + the paused checkpoint live in the durable
         * RunStore). Requires `.withDurableRuns()`. Clone of `decideAndResumeRun`.
         * Moved verbatim from `ReactiveAgent.respondToInteraction`.
         */
        async respondToInteraction(
            runId: string,
            interactionId: string,
            value: unknown,
        ): Promise<AgentResult> {
            if (!deps.durableResume) {
                throw new Error(
                    'respondToInteraction() requires .withDurableRuns() — this agent has no durable run store.',
                )
            }
            const { dir, configHash } = deps.durableResume
            const dbPath = join(dir, 'runs.db')

            // 1. Record the human response (fails InteractionStateError if not pending).
            await Effect.runPromise(
                decideInteractionRecord({
                    dbPath,
                    runId,
                    interactionId,
                    valueJson: JSON.stringify(value),
                }),
            )

            // 2. Load + guard the paused checkpoint.
            const payload = await Effect.runPromise(
                loadResumePayload({ runId, dbPath, currentConfigHash: configHash }),
            )

            // 3. Resume through the durable wrapper (same as approve/deny), seeding the
            //    restored state + the interaction response. The runner injects the
            //    value as the pending interaction's result and re-thinks to completion.
            return deps.runDurable({
                input: payload.run.task,
                taskId: runId,
                runId,
                task: payload.run.task,
                resume: {
                    stateJson: payload.stateJson,
                    interaction: { interactionId, valueJson: JSON.stringify(value) },
                },
            })
        },
    }
    return facade
}
