/**
 * Durable-run facade — the Phase C / Phase D / Task 10 durable-run surface of
 * `ReactiveAgent` moved out of `reactive-agent.ts` (#217 / HS-247):
 * `resumeRun`, `fork`, `listRuns`, `approveRun`, `denyRun`,
 * `decideAndResumeRun`, `listPendingApprovals`, `getDurableInfo`,
 * `listPendingInteractions`, `respondToInteraction`.
 *
 * The public class methods are thin one-line delegates that construct the
 * {@link DurableFacadeDeps} object per call, forward here, and run the
 * returned Effect through the agent's `ManagedRuntime`. Since Quality
 * program Task 10 (D1 bridge family 3, the Task 6/8 template, PRs #274 /
 * #276, applied to durable) the module boundary is Effect-native: every
 * async method is now a SYNCHRONOUS method returning
 * `Effect.Effect<A, E, R>` with a precise error channel, and the family's
 * only Promise boundary is the class shell running the returned Effect
 * through the shared `runFacadeEffect` helper
 * (`agent/run-facade-effect.ts`, called by the `reactive-agent.ts`
 * delegates). `runDurable` itself STAYED in `reactive-agent.ts` because
 * `run()` shares it — the facade receives it wired through deps, still as a
 * Promise dep.
 *
 * Rejection-VALUE identity vs. the pre-bridge async methods is preserved by
 * construction, in three classes (this is the family's mixed-boundary case:
 * global `Effect.runPromise` sites and `deps.runtime.runPromise` sites
 * interleaved; every such site below whose rejection value callers observe
 * today keeps its inner boundary rather than folding):
 *   • BACKEND failures (`loadResumePayload` / `loadForkPayload` /
 *     `markRunStatus` / `listDurableRuns` / `getPendingApprovalAt` /
 *     `getPendingInteractionAt` / `decideApprovalRecord` /
 *     `decideInteractionRecord` via `Effect.runPromise`, the resume pipeline
 *     via `deps.runtime.runPromise`, and the `deps.runDurable(...)` tail
 *     calls) KEEP their inner runPromise boundary, wrapped in
 *     `Effect.promise`: pre-bridge they reached callers as THAT call's
 *     `FiberFailure` wrapper, not the raw cause, so the wrapper instance is
 *     the observable value. `Effect.promise` folds the rejection to a defect
 *     carrying the same instance and the shell bridge re-raises it verbatim
 *     (Task 6 `loadSkill` precedent) - byte-identical observable behavior,
 *     and the global sites still run on the default runtime exactly as
 *     before (fiber/scope parenting unchanged). Tripwired per-site below.
 *   • the `E` channel carries ONLY the deliberate guard failures (the
 *     "requires .withDurableRuns()" arms) plus the `resumeRun` catch-arm's
 *     `unwrapErrorWithSuggestion(...)` re-raise, same messages, same construction
 *     construction sites (count-neutral; no tagged-error algebra migration
 *     mid-bridge). Pre-bridge these were sync throws / rethrows inside the
 *     facade's async methods, which already reached callers as the RAW
 *     value; post-bridge the shell bridge folds the channel and re-rejects
 *     the same instance - byte-identical here too (no delta at all).
 *   • incidental sync throws inside the gens (`crypto.randomUUID`,
 *     `JSON.stringify` on a circular value, a throwing
 *     `deps.buildRunTaskEffect`) fold to defects carrying the original
 *     instance and are re-raised raw by the shell, the same values the
 *     async methods rejected with.
 *
 * `getDurableInfo()` stays a SYNCHRONOUS pure accessor: it has no Promise
 * boundary to bridge, and converting it to an Effect would change the public
 * class signature from sync-value to Promise for every caller, an
 * observable API break outside this template's identity guarantees.
 */

import { Effect } from 'effect'
import { ManagedRuntime } from 'effect'
import {
    ResumeStateRef,
    RecoveredToolEffectsRef,
    toolEffectIdentityKey,
} from '@reactive-agents/core'
import type { EffectReceiptRecord, ToolEffectRecord } from '@reactive-agents/core'
import { join } from 'node:path'
import type { ToolEffectRow } from '../services/run-store.js'
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
import { safeParseJson } from './_json.js'

/**
 * Reconcile a crashed run's tool-effect rows for resume (GH #262).
 *
 * TWO consumers, one pass over the rows:
 *   - the SUCCESS-visible subset (`succeeded` rows) becomes the
 *     `RecoveredToolEffectsRef` seed map, keyed by
 *     `toolEffectIdentityKey(toolName, argsJson)`; the kernel act phase
 *     consults it before each dispatch and injects the recorded result
 *     WITHOUT re-executing when a matching succeeded record exists.
 *   - the receipt ledger: `succeeded` rows stamp the receipt `recovered`
 *     (the effect demonstrably happened and was not re-executed — either
 *     injected on resume when the call was re-derived, or already carried
 *     inside the restored checkpoint state, in which case the store row is
 *     its durable proof), while terminal-less `executing` rows stamp
 *     `ambiguous-then-replayed` (only the pre-effect write committed, so the
 *     resumed run MUST dispatch live to find out). `failed` rows carry no
 *     recovery semantics and are omitted — the failure is already visible in
 *     the restored steps and the receipt's toolCallStats.
 *
 * Documented fallback (per the parent coordination note): consumption-aware
 * statuses would scan the resumed run's step metadata (`recoveredEffect` is
 * marked by the kernel on injected steps), but under the kernel contract
 * every re-derived call either consumes a succeeded record or is absent from
 * it — so the row-status fallback below is faithful for both halves and
 * needs no coupling to the kernel's step-metadata shape.
 */
export const reconcileToolEffects = (rows: readonly ToolEffectRow[]): {
    recoveredMap: Map<string, ToolEffectRecord>
    receiptEffects: readonly EffectReceiptRecord[]
} => {
    const succeeded = rows.filter((r) => r.status === 'succeeded')
    const executing = rows.filter((r) => r.status === 'executing')
    const recoveredMap = new Map<string, ToolEffectRecord>()
    for (const row of succeeded) {
        recoveredMap.set(toolEffectIdentityKey(row.toolName, row.argsJson), {
            toolName: row.toolName,
            toolCallId: row.toolCallId,
            iteration: row.iteration,
            argsJson: row.argsJson,
            status: 'succeeded',
            resultContent: row.resultContent ?? '',
            effectId: row.effectId,
        })
    }
    const receiptEffects: EffectReceiptRecord[] = [
        ...succeeded.map(
            (row): EffectReceiptRecord => ({
                toolName: row.toolName,
                argsJson: row.argsJson,
                status: 'recovered',
                effectId: row.effectId,
                iteration: row.iteration,
            }),
        ),
        ...executing.map(
            (row): EffectReceiptRecord => ({
                toolName: row.toolName,
                argsJson: row.argsJson,
                status: 'ambiguous-then-replayed',
                effectId: row.effectId,
                iteration: row.iteration,
            }),
        ),
    ]
    return { recoveredMap, receiptEffects }
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
    /**
     * The agent's ManagedRuntime. Since Task 10 (D1 bridge) the facade
     * methods return Effects and the class shell runs them; this field is
     * still read directly by `resumeRun`'s pipeline execution, whose inner
     * runPromise is preserved for rejection-VALUE identity (see its JSDoc).
     * The pipeline effect is seam-typed `Effect<AgentResult, Error>` (the
     * `buildRunTaskEffect` dep), i.e. `R = never`, so the precise runtime
     * view here is `never`.
     */
    readonly runtime: ManagedRuntime.ManagedRuntime<never, never>
    readonly buildRunTaskEffect: (input: string, options?: {
        readonly taskId?: string
        readonly durableRunId?: string
        readonly forkedFrom?: string
        /** Durable tool-effect ledger (GH #262) — threaded from `resumeRun`. */
        readonly recoveredToolEffects?: readonly EffectReceiptRecord[]
    }) => Effect.Effect<AgentResult, Error>
    /**
     * `ReactiveAgent.runDurable` - still the class's Promise-based durable
     * runner (the run-task family is a separate bridge step). Facade tail
     * calls preserve this boundary inside `Effect.promise` so its rejection
     * values reach callers identically pre-/post-bridge.
     */
    readonly runDurable: (params: RunDurableParams) => Promise<AgentResult>
}

/**
 * Build the durable-run facade object, the durable primitives moved from
 * `reactive-agent.ts` internals and Effect-typed per Task 10 (D1 bridge
 * family 3; the Task 6/8 template).
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
         *
         * Effect-typed (Task 10): `E = Error` carries only the deliberate
         * guard failure (message verbatim - pre-bridge an async-method throw,
         * already raw at callers; the bridge re-rejects the same instance)
         * and the catch-arm's `unwrapErrorWithSuggestion` re-raise (same
         * derived value as the pre-bridge rethrow). ALL FOUR backend sites
         * (checkpoint load, pipeline run, completed/failed status marks)
         * keep their inner runPromise boundaries inside `Effect.promise`;
         * their `FiberFailure` wrappers are the values callers observe
         * today, and the async try/catch scoping (status-marks INSIDE the
         * guarded region, so a failed `completed` mark routes through the
         * same catch-arm) is mirrored by construction below.
         */
        resumeRun(runId: string): Effect.Effect<AgentResult, Error> {
            return Effect.gen(function* () {
                if (!deps.durableResume) {
                    return yield* Effect.fail(
                        new Error(
                            'resumeRun() requires .withDurableRuns() — this agent has no durable run store.',
                        ),
                    )
                }
                const { dir, configHash } = deps.durableResume
                const dbPath = join(dir, 'runs.db')

                // 1. Load + guard the checkpoint on the default runtime (RunStore is
                //    self-contained; no agent services required).
                //    PRESERVED INNER BOUNDARY: the global runPromise's
                //    FiberFailure wrapper is the value callers observe when
                //    the run/checkpoint is unknown or the hash drifts (the
                //    mismatch test matches its String()); wrapping the
                //    SAME call in Effect.promise folds that wrapper into a
                //    defect the bridge re-raises verbatim.
                const payload = yield* Effect.promise(() =>
                    Effect.runPromise(
                        loadResumePayload({ runId, dbPath, currentConfigHash: configHash }),
                    ),
                )

                // 2. Reconcile the crashed run's tool-effect rows (GH #262):
                //    succeeded rows seed `RecoveredToolEffectsRef` (the kernel act
                //    phase injects their results WITHOUT re-executing), all
                //    recovery-bearing rows thread the trust receipt, and the
                //    terminal-less `executing` rows keep their ambiguity
                //    inspectable in the store.
                const { recoveredMap, receiptEffects } = reconcileToolEffects(
                    payload.toolEffects,
                )

                // 3. Re-run to completion with the restored state + the recovered
                //    effects seeded via FiberRef.
                //    - reasoning-think reads ResumeStateRef, deserializes, and
                //      forwards it as KernelInput.resumeState so the runner
                //      continues mid-stream.
                //    - The kernel act phase reads RecoveredToolEffectsRef before
                //      each dispatch; a matching succeeded record means the
                //      effect already happened. Null-seeding is skipped entirely
                //      (runs with no recorded effects resume at zero cost).
                const pipeline = deps.buildRunTaskEffect(payload.run.task, {
                    taskId: runId,
                    ...(receiptEffects.length > 0 ? { recoveredToolEffects: receiptEffects } : {}),
                })
                const withRecovery =
                    recoveredMap.size > 0
                        ? Effect.locally(pipeline, RecoveredToolEffectsRef, recoveredMap)
                        : pipeline
                // The pre-bridge async try/catch region (verbatim scoping):
                // BOTH the pipeline run and the `completed` status mark are
                // guarded; a rejection anywhere in the region marks the run
                // `failed` (its own boundary kept inside the catch arm) and
                // re-raises the unwrapped error. `deps.runtime.runPromise`
                // keeps its inner boundary (a rejecting pipeline reached
                // callers as THAT call's wrapper pre-bridge, which is what
                // `unwrapErrorWithSuggestion` receives as input in both
                // shapes); the status marks keep the global default-runtime
                // boundary: parenting and event sequencing unchanged.
                return yield* Effect.gen(function* () {
                    const result = yield* Effect.promise(() =>
                        deps.runtime.runPromise(
                            Effect.locally(withRecovery, ResumeStateRef, payload.stateJson),
                        ),
                    )
                    yield* Effect.promise(() =>
                        Effect.runPromise(
                            markRunStatus({ dbPath, runId, status: 'completed' }),
                        ),
                    )
                    return result
                }).pipe(
                    Effect.catchAllDefect((e) =>
                        Effect.gen(function* () {
                            yield* Effect.promise(() =>
                                Effect.runPromise(
                                    markRunStatus({ dbPath, runId, status: 'failed' }),
                                ),
                            )
                            return yield* Effect.fail(unwrapErrorWithSuggestion(e))
                        }),
                    ),
                )
            })
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
         *
         * Effect-typed (Task 10): `E = Error` is only the deliberate guard
         * failure (message verbatim, raw at callers on both sides). The
         * checkpoint load keeps its global runPromise boundary (wrapper
         * identity) and the `deps.runDurable` tail keeps the dep's Promise
         * boundary (its rejection reached callers verbatim pre-bridge as
         * the adopted tail promise; `Effect.promise` folds the same
         * instance to a defect the bridge re-raises verbatim).
         */
        fork(
            runId: string,
            opts?: { at?: number; model?: string; task?: string },
        ): Effect.Effect<AgentResult, Error> {
            return Effect.gen(function* () {
                if (!deps.durableResume) {
                    return yield* Effect.fail(
                        new Error(
                            'fork() requires .withDurableRuns() — this agent has no durable run store.',
                        ),
                    )
                }
                const { dir } = deps.durableResume
                const dbPath = join(dir, 'runs.db')

                // 1. Load the source checkpoint — any iteration, no config-hash guard.
                //    PRESERVED INNER BOUNDARY (wrapper identity, as resumeRun).
                const payload = yield* Effect.promise(() =>
                    Effect.runPromise(
                        loadForkPayload({ runId, dbPath, at: opts?.at }),
                    ),
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
                //    PRESERVED DEPS BOUNDARY: `runDurable` is still the class's
                //    Promise runner; its rejection value adopts through the
                //    pre-bridge tail return, and through `Effect.promise` +
                //    the shell bridge here, same instance on both channels.
                return yield* Effect.promise(() =>
                    deps.runDurable({
                        input: task,
                        taskId: forkedRunId,
                        runId: forkedRunId,
                        task,
                        resume: { stateJson: payload.stateJson },
                        ...(opts?.model !== undefined ? { modelOverride: opts.model } : {}),
                        forkedFrom: runId,
                        forkedAtIteration: payload.iteration,
                    }),
                )
            })
        },

        /**
         * List persisted durable runs (newest-updated first), optionally filtered by
         * lifecycle status. Requires `.withDurableRuns()`. Moved verbatim from
         * `ReactiveAgent.listRuns`.
         *
         * Effect-typed (Task 10): `E = Error` is only the deliberate guard
         * failure; the store read keeps its global runPromise boundary
         * (wrapper identity).
         */
        listRuns(filter?: { status?: RunStatus; userId?: string }): Effect.Effect<readonly RunRecord[], Error> {
            return Effect.gen(function* () {
                if (!deps.durableResume) {
                    return yield* Effect.fail(
                        new Error(
                            'listRuns() requires .withDurableRuns() — this agent has no durable run store.',
                        ),
                    )
                }
                const dbPath = join(deps.durableResume.dir, 'runs.db')
                return yield* Effect.promise(() =>
                    Effect.runPromise(
                        listDurableRuns({ dbPath, status: filter?.status, userId: filter?.userId }),
                    ),
                )
            })
        },

        /**
         * Durable HITL (Phase D): approve a paused run and resume it to
         * completion (moved verbatim from `ReactiveAgent.approveRun`).
         *
         * Effect-typed (Task 10): forwards the {@link decideAndResumeRun}
         * Effect; all rejection identity lives there.
         */
        approveRun(runId: string, opts?: { reason?: string }): Effect.Effect<AgentResult, Error> {
            return facade.decideAndResumeRun(runId, { status: 'approved', reason: opts?.reason })
        },

        /**
         * Durable HITL (Phase D): deny a run's paused action and resume it to
         * completion (moved verbatim from `ReactiveAgent.denyRun`).
         *
         * Effect-typed (Task 10): forwards the {@link decideAndResumeRun}
         * Effect; all rejection identity lives there.
         */
        denyRun(runId: string, reason: string): Effect.Effect<AgentResult, Error> {
            return facade.decideAndResumeRun(runId, { status: 'denied', reason })
        },

        /**
         * Record an approve/deny decision then resume the run from its checkpoint. (Moved verbatim — formerly private `decideAndResumeRun`.)
         *
         * Effect-typed (Task 10): `E = Error` is only the deliberate guard
         * failure. The decision record (an `ApprovalStateError` today rides
         * the global runPromise wrapper to callers, the API-surface test
         * matches on its text), the checkpoint load, and the
         * `deps.runDurable` tail ALL keep their inner boundaries (wrapper /
         * same-instance identity).
         */
        decideAndResumeRun(
            runId: string,
            decision: { status: 'approved' | 'denied'; reason?: string },
        ): Effect.Effect<AgentResult, Error> {
            return Effect.gen(function* () {
                if (!deps.durableResume) {
                    return yield* Effect.fail(
                        new Error(
                            'approveRun()/denyRun() requires .withDurableRuns() — this agent has no durable run store.',
                        ),
                    )
                }
                const { dir, configHash } = deps.durableResume
                const dbPath = join(dir, 'runs.db')

                // 1. Record the human decision (fails ApprovalStateError if not pending).
                //    PRESERVED INNER BOUNDARY: today callers see this global
                //    runPromise's FiberFailure wrapper, not the raw tagged
                //    error; the wrapper's String() (cause identity in its
                //    name) is what the no-pending-approval test matches.
                const { gateId } = yield* Effect.promise(() =>
                    Effect.runPromise(
                        decideApprovalRecord({ dbPath, runId, status: decision.status, reason: decision.reason }),
                    ),
                )

                // 2. Load + guard the paused checkpoint.
                //    PRESERVED INNER BOUNDARY (as `resumeRun` step 1).
                const payload = yield* Effect.promise(() =>
                    Effect.runPromise(
                        loadResumePayload({ runId, dbPath, currentConfigHash: configHash }),
                    ),
                )

                // 3. Resume through the durable wrapper (same as run()), seeding the restored
                //    state + the decision. Using runDurable means a re-pause on resume is
                //    persisted + surfaced (multi-gate), and completion flips to `completed`.
                //    PRESERVED DEPS BOUNDARY (as `fork` step 3).
                return yield* Effect.promise(() =>
                    deps.runDurable({
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
                    }),
                )
            })
        },

        /**
         * Durable HITL (Phase D): list runs paused awaiting a human decision, with the
         * pending action (tool + args) for each. Requires `.withDurableRuns()`.
         * Moved verbatim from `ReactiveAgent.listPendingApprovals`.
         *
         * Effect-typed (Task 10): `E = Error` is only the deliberate guard
         * failure; the run listing and every per-run pending-approval read
         * keep their global runPromise boundaries, and the sequential
         * per-run order is unchanged (yield* inside the same for-of).
         */
        listPendingApprovals(): Effect.Effect<
            readonly {
                runId: string
                gateId: string
                toolName: string
                args: unknown
                task: string
                updatedAt: number
            }[],
            Error
        > {
            return Effect.gen(function* () {
                if (!deps.durableResume) {
                    return yield* Effect.fail(
                        new Error('listPendingApprovals() requires .withDurableRuns().')
                    )
                }
                const dbPath = join(deps.durableResume.dir, 'runs.db')
                const runs = yield* Effect.promise(() =>
                    Effect.runPromise(
                        listDurableRuns({ dbPath, status: 'awaiting-approval' }),
                    ),
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
                    const pending = yield* Effect.promise(() =>
                        Effect.runPromise(
                            getPendingApprovalAt({ dbPath, runId: run.runId }),
                        ),
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
            })
        },

        /**
         * Agentic-UI interaction rail (Task 10): the durable store location + agent id
         * for this agent when built with `.withDurableRuns()`, else `undefined`.
         * Lets server adapters (Task 12) resolve the db path without reaching into
         * builder internals. Matches how `runDurable`/`listRuns` compute the db path.
         * Moved verbatim from `ReactiveAgent.getDurableInfo`.
         *
         * Stays SYNCHRONOUS (Task 10 audit): a pure function of deps with no
         * runPromise/await site at all: there is no Promise boundary to
         * bridge, and wrapping it in an Effect would change the class
         * method's public signature from a sync value to a Promise. The
         * `reactive-agent.ts` delegate therefore forwards it directly.
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
         *
         * Effect-typed (Task 10): same boundary policy as
         * `listPendingApprovals` (guard-only `E`, preserved store reads).
         */
        listPendingInteractions(): Effect.Effect<
            readonly {
                runId: string
                interactionId: string
                kind: string
                prompt: string
                schema: unknown
                task: string
                updatedAt: number
            }[],
            Error
        > {
            return Effect.gen(function* () {
                if (!deps.durableResume) {
                    return yield* Effect.fail(
                        new Error('listPendingInteractions() requires .withDurableRuns().')
                    )
                }
                const dbPath = join(deps.durableResume.dir, 'runs.db')
                const runs = yield* Effect.promise(() =>
                    Effect.runPromise(
                        listDurableRuns({ dbPath, status: 'awaiting-interaction' }),
                    ),
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
                    const pending = yield* Effect.promise(() =>
                        Effect.runPromise(
                            getPendingInteractionAt({ dbPath, runId: run.runId }),
                        ),
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
            })
        },

        /**
         * Agentic-UI interaction rail (Task 10): record a human's response to a run
         * that paused for `request_user_input` and resume it to completion. Callable
         * from ANY process (the response + the paused checkpoint live in the durable
         * RunStore). Requires `.withDurableRuns()`. Clone of `decideAndResumeRun`.
         * Moved verbatim from `ReactiveAgent.respondToInteraction`.
         *
         * Effect-typed (Task 10): `E = Error` is only the deliberate guard
         * failure; the response record (an `InteractionStateError` today
         * rides the global runPromise wrapper), the checkpoint load, and the
         * `deps.runDurable` tail ALL keep their inner boundaries. The two
         * `JSON.stringify(value)` sites stay inline: a throw there (circular
         * input) folded to a defect carrying the original TypeError both
         * pre-bridge (async sync-throw) and post-bridge (gen body throw).
         */
        respondToInteraction(
            runId: string,
            interactionId: string,
            value: unknown,
        ): Effect.Effect<AgentResult, Error> {
            return Effect.gen(function* () {
                if (!deps.durableResume) {
                    return yield* Effect.fail(
                        new Error(
                            'respondToInteraction() requires .withDurableRuns() — this agent has no durable run store.',
                        ),
                    )
                }
                const { dir, configHash } = deps.durableResume
                const dbPath = join(dir, 'runs.db')

                // 1. Record the human response (fails InteractionStateError if not pending).
                //    PRESERVED INNER BOUNDARY (wrapper identity, as the
                //    approval counterpart in decideAndResumeRun).
                yield* Effect.promise(() =>
                    Effect.runPromise(
                        decideInteractionRecord({
                            dbPath,
                            runId,
                            interactionId,
                            valueJson: JSON.stringify(value),
                        }),
                    ),
                )

                // 2. Load + guard the paused checkpoint.
                //    PRESERVED INNER BOUNDARY (as `resumeRun` step 1).
                const payload = yield* Effect.promise(() =>
                    Effect.runPromise(
                        loadResumePayload({ runId, dbPath, currentConfigHash: configHash }),
                    ),
                )

                // 3. Resume through the durable wrapper (same as approve/deny), seeding the
                //    restored state + the interaction response. The runner injects the
                //    value as the pending interaction's result and re-thinks to completion.
                //    PRESERVED DEPS BOUNDARY (as `fork` step 3).
                return yield* Effect.promise(() =>
                    deps.runDurable({
                        input: payload.run.task,
                        taskId: runId,
                        runId,
                        task: payload.run.task,
                        resume: {
                            stateJson: payload.stateJson,
                            interaction: { interactionId, valueJson: JSON.stringify(value) },
                        },
                    }),
                )
            })
        },
    }
    return facade
}
