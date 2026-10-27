/**
 * `ReactiveAgent.buildRunTaskEffect` — the core task-execution Effect builder —
 * moved out of `reactive-agent.ts` (#217 / HS-247) as the largest single method
 * (~400 LOC). The class keeps a thin private delegate that constructs the
 * {@link RunTaskDeps} object per call and forwards here.
 *
 * Function bodies were moved verbatim; class-state writes
 * (`_lastDebrief`, `_lastRunObservations`, `_lastReasoningSteps`) became explicit
 * setter dep closures so the class fields remain the single source of truth.
 * `parseJsonLoose` moved here too (it was only ever called from this method).
 *
 * D1 bridge family 4 (Quality program Task 11) boundary audit: this module's
 * public seam — `buildRunTaskEffect` — has returned
 * `Effect.Effect<AgentResult, Error>` since the #217 extraction, so the
 * family is already Effect-native at the module boundary. The remaining
 * Promise-boundary decisions, per site:
 *   - the receipt-signing site keeps its preserved `Effect.promise` boundary
 *     (it never surfaces rejections: the `.catch` degrades to the unsigned
 *     result on every arm);
 *   - the two debrief-fiber sites (lazy `debriefRich()` closure + the
 *     fire-and-forget dispose tracker) route through the shared shell bridge
 *     `runFacadeEffect` — provably identity-safe because BOTH arms discard
 *     every rejection value (the closure `.catch` resolves to the synchronous
 *     debrief, the tracker `.catch` is a no-op), so raw-vs-wrapper rejection
 *     identity is unobservable at those boundaries; they are tripwired in
 *     `packages/runtime/tests/seam-agent-run-task-facade.test.ts`;
 *   - the shell delegates in `reactive-agent.ts` KEEP their structure (the
 *     brief's STOP rule, not a forced fold): `run()` threads the killswitch
 *     AbortSignal as a `runPromise` options argument the shared bridge cannot
 *     carry (dropping it would change terminate() interrupt behavior —
 *     `terminate-aborts-inflight.test.ts` pins that flow); `runDurable`'s
 *     pipeline await is the preserved rejection-VALUE boundary family 3
 *     (#278) documented for its facade consumers (wrapper identity delivered
 *     verbatim through their `Effect.promise` dep boundary); `runEffect` is
 *     already Effect-typed at its public seam and its inner
 *     runtime-round-trip preserves the wrapper instance it has always
 *     delivered (folding it would change the public requirements signature).
 */

import {
    Effect,
    Schema,
    Fiber,
} from 'effect'
import { ManagedRuntime } from 'effect'
import { runFacadeEffect } from './run-facade-effect.js'
import {
    generateTaskId,
    AgentId,
    TaskId,
    type TrustReceipt,
    type EffectReceiptRecord,
} from '@reactive-agents/core'
import type {
    Task,
    TaskResult,
    TaskError,
    OutputFormat,
    TerminatedBy,
} from '@reactive-agents/core'
import { LLMService, resolveCapability } from '@reactive-agents/llm-provider'
import type { SchemaContract, ReasoningStep } from '@reactive-agents/reasoning'
import {
    groundedExtract,
    buildEvidenceCorpusFromSteps,
    parsePartial,
    stripThinking,
    groundFields,
} from '@reactive-agents/reasoning'
import { deriveTaskOutcome, deriveMetadataToolCalls } from '../engine/finalize/derive-outcome.js'
import { deriveReceiptModelId } from '../builder/helpers.js'
import { resolveReceiptSigningKey, signReceipt } from '../receipt-signing.js'
import { projectAbstention } from '../engine/abstention-projection.js'
import { extractObjectFromAnswer } from '../engine/finalize/extract-object.js'
import { chooseStructuredEngine } from '../engine/finalize/structured-route.js'
import { StructuredOutputError } from '../errors/structured-output-error.js'
import type { RuntimeErrors } from '../errors.js'
import type {
    AgentResult,
    AgentResultMetadata,
    OutputSchemaOptions,
} from '../builder/types.js'
import type { AgentDebrief } from '../debrief.js'
import { safeParseJson } from './_json.js'

/**
 * Loosely parse the first complete JSON value (object `{…}` or array `[…]`)
 * from `text` after stripping thinking tags, markdown fences, and leading prose.
 *
 * Returns the parsed value (object or array) on success, or `null` if no
 * top-level JSON structure can be found or parsed.
 *
 * (Moved verbatim from `ReactiveAgent.parseJsonLoose` — it was private static
 * and only ever called from `buildRunTaskEffect`.)
 */
const parseJsonLoose = (text: string): unknown => {
    const cleaned = stripThinking(text).trim()
    // Strip markdown code fences: ```json … ``` or ``` … ```
    const defenced = cleaned
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?```\s*$/, "")
        .trim()

    // Try to find first `{` (object) or `[` (array) and parse from there.
    const braceIdx = defenced.indexOf("{")
    const bracketIdx = defenced.indexOf("[")
    // Pick the earlier of the two (or whichever is present)
    let startIdx: number
    if (braceIdx === -1 && bracketIdx === -1) return null
    if (braceIdx === -1) startIdx = bracketIdx
    else if (bracketIdx === -1) startIdx = braceIdx
    else startIdx = Math.min(braceIdx, bracketIdx)

    const candidate = defenced.slice(startIdx)
    try {
        return JSON.parse(candidate)
    } catch {
        // Try parsePartial for objects — handles truncated/fenced input
        if (candidate.startsWith("{")) {
            const partial = parsePartial(candidate)
            // parsePartial returns {} on failure; treat empty as failure
            if (Object.keys(partial).length > 0) return partial
        }
        return null
    }
}

/** Options of `buildRunTaskEffect` — mirrors the class method's inline options type verbatim. */
export interface RunTaskEffectOptions {
    readonly taskId?: string
    readonly maxIterations?: number
    readonly durableRunId?: string
    /** Fork lineage (Arc 1 Task 6) — threaded from `runDurable`/`fork()` so the trust receipt (Task 8) can surface it. */
    readonly forkedFrom?: string
    /**
     * Durable tool-effect reconciliation ledger (GH #262) — threaded by the
     * resume path (`resumeRun`) from the crashed run's `run_effects` rows so
     * the trust receipt binds recovered/ambiguous effects to their stable
     * identity. Absent on every ordinary run.
     */
    readonly recoveredToolEffects?: readonly EffectReceiptRecord[]
}

/**
 * Explicit dependency surface — exactly the `ReactiveAgent` fields/methods the
 * moved `buildRunTaskEffect` body reads/writes.
 */
export interface RunTaskDeps {
    readonly agentId: string
    readonly engine: {
        execute: (
            task: Task
        ) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>
    }
    /**
     * The agent's ManagedRuntime. This module never runs an effect through it
     * directly — the field is forwarded to the shared family bridge
     * (`runFacadeEffect`, whose runtime parameter is deliberately
     * requirement-generic by design). ManagedRuntime is contravariant in its requirement type, so
     * a `never`-typed field would not flow into that bridge; `unknown` is the
     * tightest requirement type that does, and the bridge's own effect
     * (`Fiber.join`, `R = never`) never needs more.
     */
    readonly runtime: ManagedRuntime.ManagedRuntime<unknown, never>
    /** Runtime configuration snapshot (the class's private `config` field). */
    readonly config: Record<string, unknown>
    readonly outputSchemaConfig?: {
        readonly contract: SchemaContract<unknown>
        readonly options: OutputSchemaOptions
    }
    readonly durableResume?: { readonly dir: string; readonly configHash: string }
    /** Whether `.withTools()` (or `.withDocuments()`) was called at build (the class's `_enableTools`). */
    readonly enableTools: boolean
    readonly setTaskDescription?: (desc: string) => void
    /** The class `_pendingDebriefs` Set, passed by reference (dispose() joins it). */
    readonly pendingDebriefs: Set<
        Fiber.RuntimeFiber<{ debrief?: AgentDebrief; tokensUsed: number }, never>
    >
    /** Setter closure: the class's `_lastDebrief` stays the single source of truth. */
    readonly setLastDebrief: (debrief: AgentDebrief) => void
    /** Setter closure: the class's `_lastRunObservations` stays the single source of truth. */
    readonly setLastRunObservations: (observations: string[]) => void
    /** Setter closure: the class's `_lastReasoningSteps` stays the single source of truth. */
    readonly setLastReasoningSteps: (steps: ReasoningStep[]) => void
    /** The class's private `buildSchemaSteering` (shared with `streamObject`, so it stayed on the class). */
    readonly buildSchemaSteering: (contract: SchemaContract<unknown>) => string
}

/**
 * Core task execution Effect (requires services from the agent's ManagedRuntime).
 * Moved verbatim from `ReactiveAgent.buildRunTaskEffect`.
 */
export const buildRunTaskEffect = (
    deps: RunTaskDeps,
    input: string,
    options?: RunTaskEffectOptions
): Effect.Effect<AgentResult, Error> => {
    // Pre-set the task description so sub-agents spawned on the first iteration
    // have access to the full user prompt (including phone numbers, URLs, etc.)
    deps.setTaskDescription?.(input.slice(0, 500))

    const taskId = options?.taskId
        ? Schema.decodeSync(TaskId)(options.taskId)
        : generateTaskId()

    // Steer the agent to emit schema-shaped JSON when a schema is configured.
    // This lets parse-first (below) skip the extra LLM extraction call on the
    // happy path — same pattern used by streamObject.
    const steeredInput = deps.outputSchemaConfig
        ? `${input}${deps.buildSchemaSteering(deps.outputSchemaConfig.contract)}`
        : input

    const task: Task = {
        id: taskId,
        agentId: Schema.decodeSync(AgentId)(deps.agentId),
        type: 'query' as const,
        input: { question: steeredInput },
        priority: 'medium' as const,
        status: 'pending' as const,
        metadata: {
            tags: [],
            ...(options?.maxIterations !== undefined
                ? { context: { maxIterations: options.maxIterations } }
                : {}),
        },
        createdAt: new Date(),
    }

    return deps.engine.execute(task).pipe(
        Effect.flatMap((result: TaskResult) => {
            const r = result as TaskResult & {
                format?: OutputFormat
                terminatedBy?: TerminatedBy
                debrief?: AgentDebrief
                awaitingApprovalFor?: { gateId: string; toolName: string; args: unknown }
                awaitingInteractionFor?: { interactionId: string; kind: string; prompt: string; schemaJson: string }
            }
            // Derive toolCalls from reasoning steps so consumers don't
            // have to filter `metadata.reasoningSteps` themselves. The
            // public AgentResult never exposed steps until now — task
            // gate / eval scripts were reading `result.steps` (undefined)
            // and seeing empty toolCalls arrays even when tools ran.
            const rawMetadata = r.metadata as AgentResultMetadata
            const reasoningSteps = (rawMetadata as { reasoningSteps?: ReadonlyArray<{
                readonly id?: string
                readonly type: string
                readonly content: string
                readonly metadata?: Record<string, unknown>
            }> }).reasoningSteps
            const derivedToolCalls = deriveMetadataToolCalls(reasoningSteps)
            const enrichedMetadata: AgentResultMetadata = {
                ...rawMetadata,
                ...(reasoningSteps !== undefined ? { reasoningSteps } : {}),
                ...(derivedToolCalls.length > 0 ? { toolCalls: derivedToolCalls } : {}),
            }
            // Rich LLM debrief: the engine forks it off the critical path and
            // attaches the fiber here. debriefRich() awaits it lazily; the
            // fiber is tracked so dispose() joins it (no dropped persist).
            const debriefFiber = (r as { _debriefFiber?: Fiber.RuntimeFiber<{ debrief?: AgentDebrief; tokensUsed: number }, never> })._debriefFiber
            // Trust receipt (Arc 1 Task 8) — graded evidence about HOW the
            // answer was produced, computed from in-memory run data (works
            // without tracing). See @reactive-agents/core's TrustReceipt
            // JSDoc: NOT a truth certificate.
            // Receipts belong to TERMINAL results only: a run paused for
            // approval/interaction is unfinished — grading it now would
            // stamp a misleading verdict, and the resumed run produces its
            // own receipt on completion. Mirrors the TrustEvent pause
            // suppression in engine/execute-stream.ts.
            const isPausedRun =
                r.awaitingApprovalFor !== undefined ||
                r.awaitingInteractionFor !== undefined
            // Single terminal-outcome computation (FM-4 part 1) — shared
            // with execute-stream.ts's runStream() path via
            // deriveTaskOutcome (engine/finalize/derive-outcome.ts), so
            // the two paths cannot silently diverge on deliverables,
            // goalAchieved, or the trust receipt. Computed unconditionally
            // (pure function, no side effects) — but `isPausedRun` is
            // threaded through so deriveTaskOutcome itself suppresses
            // `deliverables` (and, transitively, `goalAchieved`'s
            // deliverable-evidence upgrade) on a paused run — see
            // DeriveTaskOutcomeCtx.isPausedRun's JSDoc for why this must
            // happen INSIDE the shared function rather than only being
            // gated by the RECEIPT discard below: a paused run with
            // declared-but-not-yet-produced deliverables would otherwise
            // read as a definitive "goal not achieved" (false) instead of
            // the correct ambiguous (null). goalAchieved is still
            // reported on paused runs, matching prior behavior (it falls
            // back to the terminatedBy-only heuristic).
            const outcome = deriveTaskOutcome(r, {
                task: input,
                ...((deps.config['requiredTools'] as { tools?: readonly string[] } | undefined)?.tools
                    ? { requiredTools: (deps.config['requiredTools'] as { tools?: readonly string[] }).tools }
                    : {}),
                ...(deps.config['taskContract'] !== undefined
                    ? { taskContract: deps.config['taskContract'] as import('@reactive-agents/core').TaskContract }
                    : {}),
                // Single shared source with the streaming site — see
                // deriveReceiptModelId's JSDoc (builder/helpers.ts).
                modelId: deriveReceiptModelId(deps.config.model, deps.config.provider),
                ...(deps.durableResume?.configHash !== undefined
                    ? { configHash: deps.durableResume.configHash }
                    : {}),
                ...(options?.forkedFrom !== undefined ? { forkedFrom: options.forkedFrom } : {}),
                // Durable tool-effect reconciliation (GH #262) — the resume
                // path threads the crashed run's effect rows here so the
                // receipt surfaces them; omitted on ordinary runs.
                ...(options?.recoveredToolEffects !== undefined &&
                options.recoveredToolEffects.length > 0
                    ? { effects: options.recoveredToolEffects }
                    : {}),
                isPausedRun,
                now: Date.now(),
            })
            const goalAchieved = outcome.goalAchieved
            // A receipt belongs to a TERMINAL result only — suppressed
            // separately here even though `isPausedRun` already forced
            // `deliverables`/`goalAchieved`'s upgrade off inside
            // deriveTaskOutcome, because the receipt carries other
            // terminal-only evidence (tool calls, interventions,
            // verifier verdict) that shouldn't be stamped on an
            // unfinished run either.
            const receipt: TrustReceipt | undefined = isPausedRun ? undefined : outcome.receipt
            const agentResult: AgentResult = {
                output: String(r.output ?? ''),
                success: r.success,
                taskId: String(r.taskId),
                agentId: String(r.agentId),
                metadata: enrichedMetadata,
                ...(receipt !== undefined ? { receipt } : {}),
                ...(r.format !== undefined ? { format: r.format } : {}),
                ...(r.terminatedBy !== undefined
                    ? { terminatedBy: r.terminatedBy }
                    : {}),
                goalAchieved,
                ...(projectAbstention(r) !== undefined
                    ? { abstention: projectAbstention(r) }
                    : {}),
                // Durable HITL (Phase D): when the run paused for human approval,
                // surface status + the pending action (with the durable runId so
                // callers can approveRun/denyRun it). durableRunId is threaded by
                // the run()/resume durable wrapper; absent on non-durable runs.
                ...(r.awaitingApprovalFor !== undefined && options?.durableRunId !== undefined
                    ? {
                          status: 'awaiting-approval' as const,
                          pendingApproval: {
                              runId: options.durableRunId,
                              gateId: r.awaitingApprovalFor.gateId,
                              toolName: r.awaitingApprovalFor.toolName,
                              args: r.awaitingApprovalFor.args,
                          },
                      }
                    : {}),
                // Agentic-UI interaction rail (Task 10): when the run paused
                // for user interaction, surface status + the pending
                // interaction (with the durable runId so callers can
                // respondToInteraction it). Mirrors awaitingApprovalFor above.
                ...(r.awaitingInteractionFor !== undefined && options?.durableRunId !== undefined
                    ? {
                          status: 'awaiting-interaction' as const,
                          pendingInteraction: {
                              runId: options.durableRunId,
                              interactionId: r.awaitingInteractionFor.interactionId,
                              kind: r.awaitingInteractionFor.kind,
                              prompt: r.awaitingInteractionFor.prompt,
                              schema: safeParseJson(r.awaitingInteractionFor.schemaJson),
                          },
                      }
                    : {}),
                ...(r.debrief !== undefined ? { debrief: r.debrief } : {}),
                ...(debriefFiber
                    ? {
                          // Task 11 (D1 family 4): shared-bridge conversion.
                          // The join's error channel is `never` and every
                          // rejection arm (typed failure, defect, interrupt)
                          // is discarded below — raw-vs-wrapper rejection
                          // identity is unobservable at this boundary, so
                          // routing it through the bridge is value-flow
                          // identical by construction (pinned in
                          // seam-agent-run-task-facade.test.ts).
                          debriefRich: () =>
                              runFacadeEffect(deps.runtime, Fiber.join(debriefFiber))
                                  .then((res) => res.debrief ?? r.debrief)
                                  .catch(() => r.debrief),
                      }
                    : {}),
                ...(r.error !== undefined ? { error: r.error } : {}),
            }
            // Capture debrief for use as context in subsequent chat() calls.
            // result.debrief is the instant deterministic fallback.
            if (agentResult.debrief) deps.setLastDebrief(agentResult.debrief)

            // Track the fiber for dispose(); upgrade _lastDebrief to the rich
            // version once it resolves; deregister when done (fire-and-forget).
            if (debriefFiber) {
                deps.pendingDebriefs.add(debriefFiber)
                // Task 11 (D1 family 4): shared-bridge conversion — the
                // tracker's only observable effects are the success-arm
                // upgrade of _lastDebrief and the pendingDebriefs cleanup;
                // rejections are discarded (no-op catch) so the bridge's
                // raw-vs-wrapper rejection difference cannot surface to any
                // caller (pinned in seam-agent-run-task-facade.test.ts).
                void runFacadeEffect(deps.runtime, Fiber.join(debriefFiber))
                    .then((res) => {
                        if (res.debrief) deps.setLastDebrief(res.debrief)
                    })
                    .catch(() => {})
                    .finally(() => {
                        deps.pendingDebriefs.delete(debriefFiber)
                    })
            }
            // Capture reasoning context so chat() has access to actual data.
            // Includes: tool observations + agent analysis thoughts (which contain
            // the synthesized data from tool results, not just compressed previews).
            const steps = ((r.metadata as { reasoningSteps?: readonly unknown[] } | undefined)?.reasoningSteps ??
                []) as Array<{
                type: string
                content: string
                metadata?: {
                    observationResult?: { success?: boolean }
                    toolUsed?: string
                }
            }>
            const contextParts: string[] = []
            for (let i = 0; i < steps.length; i++) {
                const s = steps[i]!
                if (s.type === 'observation') {
                    // Include successful observations (tool results)
                    if (
                        s.metadata?.observationResult?.success !== false &&
                        s.content.length > 10 &&
                        !s.content.startsWith('⚠️') &&
                        !s.content.startsWith('✓ final-answer')
                    ) {
                        contextParts.push(`[Tool result]: ${s.content}`)
                    }
                } else if (s.type === 'thought' && i > 0) {
                    // Include analysis thoughts that follow observations — these contain
                    // the actual synthesized data (e.g. commit summaries, parsed results).
                    const prev = steps[i - 1]
                    if (
                        prev?.type === 'observation' &&
                        s.content.length > 50
                    ) {
                        contextParts.push(`[Agent analysis]: ${s.content}`)
                    }
                }
            }
            deps.setLastRunObservations(contextParts)
            // Reuses the SAME `reasoningSteps` variable (and its existing
            // single-assertion cast pattern, see buildEvidenceCorpusFromSteps
            // below) rather than the narrower inline-typed `steps` local
            // above — avoids introducing a new `as unknown as` double-cast
            // site (WS-5b ceiling, packages/runtime/test/as-unknown-as-ceiling.test.ts).
            deps.setLastReasoningSteps((reasoningSteps ?? []) as readonly ReasoningStep[] as ReasoningStep[])

            // ── Structured output extraction (Task 1.4 / 1.5) ───────────
            const outputSchemaConfig = deps.outputSchemaConfig
            if (!outputSchemaConfig) {
                return Effect.succeed(agentResult)
            }
            // Task 1.5 / 2.5: resolve the fast/grounded route before extracting.
            // LLMService is in the ManagedRuntime context (same requirement as
            // extractObjectFromAnswer / groundedExtract), so we can flatMap over it here.
            // Build evidence corpus from reasoning steps — used by the grounded engine.
            // reasoningSteps is already captured above; we cast to ReasoningStep[] for
            // buildEvidenceCorpusFromSteps (only accesses type/content/metadata fields
            // that are present on the inline type captured at line ~793).
            const evidenceCorpus = buildEvidenceCorpusFromSteps(
                (reasoningSteps ?? []) as readonly ReasoningStep[]
            )
            // ── Parse-first: try to extract the object from the agent's own
            // answer before touching the LLM. The steering injected above
            // (buildSchemaSteering) makes the agent emit schema-shaped JSON
            // directly, so on the happy path this succeeds and we skip the
            // extra extraction LLM call entirely (~28s on local models).
            const parsedLoose = parseJsonLoose(agentResult.output)
            const directValidation = parsedLoose !== null
                ? outputSchemaConfig.contract.validate(parsedLoose)
                : null

            const onParseFail = outputSchemaConfig.options.onParseFail ?? 'degrade'

            if (directValidation?.ok === true) {
                // ── Happy path: agent already emitted valid JSON — zero extra LLM calls.
                // For grounded mode we still compute provenance/confidence via groundFields
                // (pure function, no LLM) so callers get the expected grounding fields.
                // Arrays are skipped for grounding (no top-level Object.entries).
                const jsonSchema = outputSchemaConfig.contract.toJsonSchema()
                const isTopLevelObject = !jsonSchema || jsonSchema["type"] === "object"
                const needsGrounding = (() => {
                    // Determine if grounded mode would have been selected, but we need
                    // to avoid an LLM call just for the engine choice. Use a synchronous
                    // heuristic: mode === "grounded" explicitly always needs grounding;
                    // "auto" and "fast" don't need groundFields on parse-first success.
                    return outputSchemaConfig.options.mode === 'grounded'
                })()

                if (needsGrounding && isTopLevelObject && typeof parsedLoose === 'object' && parsedLoose !== null && !Array.isArray(parsedLoose)) {
                    // Pure provenance computation — no LLM call.
                    const grounded = groundFields(
                        parsedLoose as Record<string, unknown>,
                        evidenceCorpus
                    )
                    const result: AgentResult = {
                        ...agentResult,
                        object: directValidation.value,
                        provenance: grounded.provenance,
                        confidence: grounded.confidence,
                    }
                    return Effect.succeed(result)
                }
                return Effect.succeed({
                    ...agentResult,
                    object: directValidation.value,
                } satisfies AgentResult)
            }

            // ── Fallback: parse-first missed — run the LLM extraction pipeline.
            // This preserves all existing behavior for prose answers / model
            // non-compliance, and handles onParseFail:"throw" correctly.
            return LLMService.pipe(
                Effect.flatMap((llm) => llm.getStructuredOutputCapabilities()),
                Effect.flatMap((structCaps) => {
                    const engine = chooseStructuredEngine({
                        mode: outputSchemaConfig.options.mode ?? 'auto',
                        nativeJsonMode: structCaps.nativeJsonMode,
                        toolsRegistered: deps.enableTools,
                        // Known model = a shipped capability entry (static table / probe /
                        // user override). An unknown model resolves to the conservative
                        // fallback and routes to the grounded repair path.
                        calibrated: isKnownModel(deps.config.provider, deps.config.model),
                    })
                    if (engine === 'grounded') {
                        // ── Task 2.5: grounded engine path ───────────────────────────────
                        // groundedExtract error channel is `never`; all failures degrade to
                        // { objectError }. We translate objectError → thrown error here when
                        // onParseFail === "throw" (callers expect StructuredOutputError).
                        return groundedExtract({
                            contract: outputSchemaConfig.contract,
                            finalAnswer: agentResult.output,
                            evidenceCorpus,
                            onParseFail,
                            abstainBelow: outputSchemaConfig.options.abstainBelow,
                        }).pipe(
                            Effect.flatMap((g) => {
                                if (g.objectError !== undefined && onParseFail === 'throw') {
                                    return Effect.fail(new StructuredOutputError({
                                        rawText: agentResult.output,
                                        issues: [g.objectError],
                                    }))
                                }
                                const result: AgentResult = {
                                    ...agentResult,
                                    ...(g.object !== undefined ? { object: g.object } : {}),
                                    ...(g.objectError !== undefined ? { objectError: g.objectError } : {}),
                                    ...(g.provenance !== undefined ? { provenance: g.provenance } : {}),
                                    ...(g.confidence !== undefined ? { confidence: g.confidence } : {}),
                                    ...(g.abstained !== undefined ? { abstained: g.abstained } : {}),
                                }
                                return Effect.succeed(result)
                            })
                        )
                    }
                    // ── Fast path (auto → fast) ───────────────────────────────────────
                    return extractObjectFromAnswer({
                        contract: outputSchemaConfig.contract,
                        finalAnswer: agentResult.output,
                        onParseFail,
                        traceContext: { taskId: String(r.taskId) },
                    }).pipe(
                        Effect.map((extracted) => ({
                            ...agentResult,
                            ...(extracted.object !== undefined ? { object: extracted.object } : {}),
                            ...(extracted.objectError !== undefined ? { objectError: extracted.objectError } : {}),
                        } satisfies AgentResult)),
                        // If onParseFail: "throw" let StructuredOutputError propagate as-is.
                        // If "degrade" extractObjectFromAnswer already catches and returns
                        // { objectError } in the success channel — nothing extra needed.
                        Effect.catchTag('StructuredOutputError', (e: StructuredOutputError) =>
                            Effect.fail(e)
                        ),
                    )
                }),
            )
        }),
        // Trust receipt signing (Arc 1 Task 9) — optional, additive. Signs
        // the ALREADY-COMPUTED receipt (attached above, whichever branch
        // produced this result) with the configured Ed25519 key, if any.
        // Never fails the run: signing errors degrade to an unsigned
        // receipt rather than surfacing a spurious failure to the caller.
        // See receipt-signing.ts's honest-claims note — the signature
        // certifies provenance/integrity of the receipt, never the
        // correctness of `result.output`.
        // Task 11: PRESERVED BOUNDARY — this `Effect.promise` wrapper is the
        // template's preserved form; the inner `.catch` degrades every
        // signing rejection to the unsigned result, so the value flow is
        // independent of rejection identity either way.
        Effect.flatMap((result: AgentResult): Effect.Effect<AgentResult, never> => {
            const key = resolveReceiptSigningKey(deps.config['receiptSigningKey'])
            const receipt = result.receipt
            if (!key || !receipt) return Effect.succeed(result)
            return Effect.promise(() =>
                signReceipt(receipt, key)
                    .then((signed) => ({ ...result, receipt: signed }) satisfies AgentResult)
                    .catch(() => result)
            )
        }),
        Effect.mapError(
            (e: RuntimeErrors | TaskError | Error) =>
                e instanceof Error ? e : new Error('message' in e ? (e as { message: string }).message : String(e))
        )
    ) as Effect.Effect<AgentResult, Error>
}

/** True when (provider, model) resolves to a real capability entry rather than the conservative fallback. */
function isKnownModel(provider: unknown, model: unknown): boolean {
  if (typeof provider !== "string" || typeof model !== "string" || !provider || !model) return false
  return resolveCapability(provider, model).source !== 'fallback'
}
