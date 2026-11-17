/**
 * run-durable.ts — run (or continue) one task with full durable wiring.
 *
 * Moved out of `reactive-agent.ts` (it shares the ledger-pinned shell's size
 * budget with nothing else): `run()` on a durable agent, `resumeRun`, `fork`
 * and `approveRun` / `denyRun` / `respondToInteraction` all run through
 * {@link runDurableRun}, so every run, a fresh one or a continued one,
 * checkpoints, registers as live (`agent.pauseRun` / `stopRun` reach it) and
 * ends in a status a host can act on:
 *
 *   - waiting on a person: `awaiting-approval` / `awaiting-interaction` (their
 *     own rails persist the pending row);
 *   - completed: `completed`;
 *   - anything else that ends the run before its work is done (a requested
 *     stop, a loop stop, a failed result, a thrown error): the run is left
 *     continuable by `agent.resumeRun` (`engine/run-interrupt.ts`).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Effect } from 'effect'
import { unwrapErrorWithSuggestion } from '../errors.js'
import { RunController, installDurableCheckpointing } from '../run-controller.js'
import { RunStoreLive, RunStoreService } from '../services/run-store.js'
import type { DurableRetention } from '../services/run-store-retention.js'
import { createDurableRun, persistApprovalPauseAt, persistInteractionPauseAt } from '../engine/durable-resume.js'
import { workspaceCarry } from '../engine/start-run.js'
import type { ActiveRuns } from '../engine/active-runs.js'
import { planPosture, seedCarry } from '../chat/todo-seed.js'
import type { AgentResult } from '../builder/agent-result.js'
import { maxIterationsCarry, type DurableFacadeDeps, type RunDurableParams } from './durable-facade.js'

/** The durable config of an agent built with `.withDurableRuns()`: where its runs live and which live runs it holds. */
export interface DurableResumeConfig {
    readonly dir: string
    readonly configHash: string
    /** Retention policy for finished runs (absent: the bounded default). */
    readonly retention?: DurableRetention
    /** The agent's live-run registry (absent on a config built without one: its runs cannot be paused by id). */
    readonly activeRuns?: ActiveRuns
}

/** What {@link runDurableRun} needs from the agent. */
export interface RunDurableDeps {
    readonly durableResume: DurableResumeConfig
    readonly agentId: string
    readonly runtime: DurableFacadeDeps['runtime']
    readonly buildRunTaskEffect: DurableFacadeDeps['buildRunTaskEffect']
}

/**
 * Run a task on the NON-streaming path with durable wiring: create the run
 * row, install per-iteration checkpointing, register the run as live, run to
 * its end and persist how it ended. Fresh runs (`run()`) and continued runs
 * (`resume` set: restored state, an approval decision, an answer, recovered
 * tool effects) share it, so a continued run checkpoints and can be paused
 * again.
 */
export const runDurableRun = async (deps: RunDurableDeps, params: RunDurableParams): Promise<AgentResult> => {
    const { dir, configHash, activeRuns } = deps.durableResume
    const dbPath = join(dir, 'runs.db')
    mkdirSync(dir, { recursive: true })
    const runStoreLayer = RunStoreLive(dbPath)

    // 1. Create (or replace) the run row.
    await Effect.runPromise(
        createDurableRun({
            dbPath,
            runId: params.runId,
            agentId: deps.agentId,
            task: params.task,
            configHash,
            ...(params.forkedFrom !== undefined ? { forkedFrom: params.forkedFrom } : {}),
            ...(params.forkedAtIteration !== undefined ? { forkedAtIteration: params.forkedAtIteration } : {}), ...workspaceCarry(params.workspace),
            ...(params.userId !== undefined ? { userId: params.userId } : {}),
            ...(params.orgId !== undefined ? { orgId: params.orgId } : {}),
        }),
    )

    // Bound the store: prune finished runs (fail-soft, resumable runs untouched).
    await Effect.runPromise(
        Effect.flatMap(RunStoreService, (store) => store.prune(deps.durableResume.retention)).pipe(
            Effect.provide(runStoreLayer),
            Effect.catchAllCause(() => Effect.void),
        ),
    )

    // 2. RunController + durable checkpointing (the kernel captures the paused
    //    state at iteration+1 so resume restores `awaitingApprovalFor`).
    const controller = new RunController(new AbortController())
    const durable = installDurableCheckpointing(controller, {
        runId: params.runId,
        runStoreLayer,
        checkpointEvery: 1,
        task: params.task,
    })
    const release = activeRuns?.register(params.runId, controller) ?? (() => undefined)

    // 3. Run the pipeline; the controller (+ resume state when resuming)
    //    is bound into the run scope by the run entry.
    const resume = params.resume
    const recovered = resume?.recovered
    const pipeline = deps.buildRunTaskEffect(params.input, {
        ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
        durableRunId: params.runId,
        ...(params.forkedFrom !== undefined ? { forkedFrom: params.forkedFrom } : {}),
        ...(params.fileRoot !== undefined ? { fileRoot: params.fileRoot } : {}), ...workspaceCarry(params.workspace), ...seedCarry(params), ...planPosture(params.posture), ...maxIterationsCarry(params),
        ...(recovered !== undefined && recovered.receiptEffects.length > 0 ? { recoveredToolEffects: recovered.receiptEffects } : {}),
        runState: {
            runController: controller,
            ...(params.modelOverride !== undefined ? { modelOverride: params.modelOverride } : {}),
            ...(resume ? { resumeState: resume.stateJson } : {}),
            ...(resume?.decision ? { approvalDecision: resume.decision } : {}),
            ...(resume?.interaction ? { interactionResponse: resume.interaction } : {}),
            ...(recovered !== undefined && recovered.recoveredMap.size > 0 ? { recoveredToolEffects: recovered.recoveredMap } : {}),
        },
    })

    try {
        const result = await deps.runtime.runPromise(pipeline)
        if (result.status === 'awaiting-approval' && result.pendingApproval) {
            // Paused — persist (status + pending row). Do NOT finish: the run
            // intentionally stays `awaiting-approval` until approve/deny.
            await Effect.runPromise(
                persistApprovalPauseAt({
                    dbPath,
                    runId: params.runId,
                    gate: {
                        gateId: result.pendingApproval.gateId,
                        toolName: result.pendingApproval.toolName,
                        args: result.pendingApproval.args,
                    },
                }),
            )
        } else if (result.status === 'awaiting-interaction' && result.pendingInteraction) {
            // Agentic-UI interaction rail (Task 10): paused for user input —
            // persist (status + pending interaction row). Do NOT finish: the
            // run stays `awaiting-interaction` until respondToInteraction.
            await Effect.runPromise(
                persistInteractionPauseAt({
                    dbPath,
                    runId: params.runId,
                    interaction: {
                        interactionId: result.pendingInteraction.interactionId,
                        kind: result.pendingInteraction.kind,
                        prompt: result.pendingInteraction.prompt,
                        schemaJson: JSON.stringify(result.pendingInteraction.schema ?? {}),
                    },
                }),
            )
        } else {
            // An interrupted run (stopped, loop-stopped, failed) says so on its result, with the resumable flag.
            const stop = await durable.settle(result)
            if (stop !== undefined) return { ...result, stop, resumable: true }
        }
        return result
    } catch (e) {
        const message: unknown = typeof e === 'object' && e !== null ? Reflect.get(e, 'message') : undefined
        await durable.interrupt('error', typeof message === 'string' ? message : String(e))
        throw unwrapErrorWithSuggestion(e)
    } finally {
        release()
    }
}
