/**
 * Public result types for a finished agent run: `AgentResult`, its
 * `AgentResultMetadata`, and the `AgentOutcome` enum.
 *
 * Moved verbatim out of builder/types.ts (2026-11-10) so the result surface
 * can grow without growing that ledger-pinned file. builder/types.ts
 * re-exports both names, so every existing import keeps working.
 */
import type { OutputFormat, Plan, TerminatedBy, TrustReceipt } from '@reactive-agents/core'
import type { AgentDebrief } from '../debrief.js'
import type { LoopStopSummary, RunStopSummary } from '../loop-stop-summary.js'

// ─── Result Types ────────────────────────────────────────────────────────────

/**
 * One mid-run strategy switch, as recorded from the kernel's
 * `StrategySwitched` event. See {@link AgentResultMetadata.strategySwitches}.
 */
export interface StrategySwitchRecord {
    /** Strategy the run switched away from. */
    readonly from: string
    /** Strategy the run switched to. */
    readonly to: string
    /** Kernel iteration of the switch; absent when the emitter did not carry it. */
    readonly iteration?: number
}

/**
 * Metadata about an agent execution result.
 *
 * Captures timing, costs, token usage, and execution details for observability and analysis.
 */
export interface AgentResultMetadata {
    /** Total wall-clock duration in milliseconds. */
    readonly duration: number
    /** Estimated cost in USD (calculated from token count). */
    readonly cost: number
    /** Tokens the run spent up to its result; excludes background debrief synthesis (see `AgentDebrief.metrics.synthesisTokens`). */
    readonly tokensUsed: number
    /** Prompt/input tokens (optional — provider may not split; see core ResultMetadataSchema). */
    readonly inputTokens?: number
    /** Completion/output tokens (optional — see inputTokens). */
    readonly outputTokens?: number
    /** LLM calls up to the result (children included; background debrief excluded, see `metrics.synthesisTokens.calls`). */
    readonly llmCalls?: number
    /** Name of the reasoning strategy that was used (e.g., "reactive", "tree-of-thought"). Default: undefined */
    readonly strategyUsed?: string
    /**
     * Every mid-run strategy switch, in the order the kernel made them
     * (`from` → `to`, plus the iteration when the emitter knew it). Lets a UI
     * show "plan-execute → reactive" instead of only the final strategy.
     * Absent when the run never switched. `strategyUsed` stays the strategy
     * that finished the run.
     */
    readonly strategySwitches?: ReadonlyArray<StrategySwitchRecord>
    /**
     * Number of reasoning steps the run recorded. Thought, action and
     * observation each count, so this exceeds `iterations` on tool runs.
     */
    readonly stepsCount: number
    /**
     * Iterations the run used: the kernel's model turns, summed over every
     * reasoning pass (continuations and verification retries included). A
     * pass with no kernel (a custom ReasoningService) counts as 1. Until
     * 2026-11-18 this field held the reasoning step count.
     */
    readonly iterations?: number
    /** Confidence level of the result. */
    readonly confidence?: 'high' | 'medium' | 'low'
    /**
     * Full reasoning trace — thought / action / observation steps as they
     * were executed. Populated by the execution engine. Useful for
     * post-run analysis, evals, and downstream debriefing. May be omitted
     * when the engine didn't surface a step trace (e.g. direct-LLM path).
     */
    readonly reasoningSteps?: ReadonlyArray<{
        readonly id?: string
        readonly type: string
        readonly content: string
        readonly metadata?: Record<string, unknown>
    }>
    /**
     * Full (uncompressed) tool-result store, keyed by `ReasoningStep.metadata.storedKey`.
     * Forwarded alongside `reasoningSteps` so evidence checks (e.g. `validateCitations`
     * from `@reactive-agents/reasoning`) read the same corpus the kernel's own grounding
     * checks use instead of the lossy compressed step-content preview.
     */
    readonly scratchpad?: Readonly<Record<string, string>>
    /**
     * Derived array of tool calls extracted from `reasoningSteps`. One entry
     * per `type === "action"` step. Convenient for tests / evals that just
     * want "which tools did the agent use" without filtering steps.
     */
    readonly toolCalls?: ReadonlyArray<{
        readonly name: string
        readonly arguments?: unknown
        readonly id?: string
    }>
    /**
     * When this result was produced by the composition API (`pipe`, `parallel`, or `race`).
     */
    readonly compositionType?: 'pipe' | 'parallel' | 'race'
    /** `pipe()` only — number of chained agent stages. */
    readonly stages?: number
    /** `parallel()` only — per-branch results. */
    readonly results?: ReadonlyArray<{
        readonly name: string
        readonly output: string
        readonly success: boolean
        readonly agentId: string
    }>
    /** `race()` only — how many agents competed. */
    readonly candidates?: number
    /**
     * Terminal judgment record (cross-cutting cascade, 2026-07-22/23) — what the
     * result-boundary mint concluded about this answer's evidence.
     *
     * - `enforced` — the run was under `.withFabricationGuard("block")` AND failed
     *   judgment, so the harness REPLACED the model's output with an honest
     *   abstention. When `true`, `output` is a sentinel, not model prose.
     * - `groundedOnRequired` — did a declared required tool actually succeed?
     *   `undefined` when the run declared none (honestly unknown, not a pass).
     * - `contractSatisfied` — did the run meet its `.withContract()` deliverables?
     * - `failed` — named judgment checks that did not pass.
     * - `auxiliaryPass` — this result was a FRAGMENT of a run (a verification
     *   retry or post-think continuation) whose grounding evidence lives in a
     *   sibling pass. Judged and recorded, never enforced. See DEBT-REGISTER §3.
     * - `repairGaps` — repair capabilities this strategy does NOT have, e.g.
     *   `"per-iteration"` for plan-execute/code-action/blueprint, which are
     *   judged only at the terminal rather than mid-loop.
     *
     * NOT a truth certificate — like {@link AgentResult.receipt}, this grades the
     * run's evidence trail, not the factual correctness of `output`.
     */
    readonly verdict?: {
        readonly enforced: boolean
        readonly groundedOnRequired?: boolean
        readonly contractSatisfied?: boolean
        readonly failed: readonly string[]
        readonly auxiliaryPass?: boolean
        readonly repairGaps?: readonly string[]
    }
    /**
     * Honest-partial markers (engine-produced, `@reactive-agents/reasoning`
     * completion-status). A run that shipped output the terminal verifier did
     * not bless as model-authored is reported `partial` (so `success` is
     * `false`) rather than `completed`.
     *
     * - `harnessAuthoredOutput` — the kernel's terminal text was authored by
     *   the harness, not the model (e.g. a normalized tool observation on a
     *   deliverable terminal). Since 2026-11-10 that text is not shipped:
     *   `output` stays `""` and landed files are on `receipt.deliverables`.
     * - `verificationWarning` — the specific unmet requirement(s) the
     *   result-boundary verifier flagged (e.g. a budget-terminal partial naming
     *   what stayed unmet).
     */
    readonly harnessAuthoredOutput?: boolean
    readonly verificationWarning?: string
    /**
     * The verifier's note on an answer it still rejected after retries, under
     * `.withVerification({ onReject: "annotate" })`. The answer in `output` is
     * shipped unchanged; this note is never prepended to it. Absent when the
     * answer passed verification or another `onReject` mode applied.
     */
    readonly verificationNote?: string
    /**
     * W5 fold: contract requirement ids the terminal evidence partition still
     * names OUTSTANDING or BLOCKED (W5.1 coverage cap). When present and
     * non-empty, the run's `success` bit is false regardless of output
     * substance: a terminal that cannot point at its remaining requirements
     * has no warrant to claim completion. Absent = nothing outstanding (or no
     * contract declared).
     */
    readonly outstandingCriteria?: readonly string[]
    /** True when the terminal was capped by the run budget, not by evidence. */
    readonly budgetTerminalPartial?: boolean
    /**
     * W5.4: the run-scoped budget meter's live total at terminal: every LLM
     * call this run made INCLUDING folded delegated-child spend, measured
     * against `.withBudget()`'s limits. Present only when a budget was armed;
     * absent on un-budgeted runs. `tokensUsed` above counts THIS agent's own
     * calls; this field is the true run spend the budget gates on.
     */
    readonly runBudgetSpend?: { readonly tokens: number; readonly cost: number }
    /**
     * W0.5 result→trace linkage. The run's ULID id, equal to the engine
     * `taskId`, the `runId` stamped on every trace event, and the base name
     * of the run's JSONL trace file. Present ONLY when the trace file was
     * recorded and flushed before this result was minted (paired with
     * {@link tracePath}); absent (not null, not a phantom) when tracing was
     * disabled or nothing was recorded. Consumed by Lift-Protocol captures
     * and `rax diagnose replay`.
     */
    readonly runId?: string
    /**
     * Absolute path to the run's JSONL trace file (`<traceDir>/<runId>.jsonl`,
     * recorder.ts flush convention), verified to exist on disk when the result
     * was minted. Together with {@link runId} this is the supported way to feed
     * a run's output into `rax diagnose replay <tracePath>`.
     */
    readonly tracePath?: string
    /**
     * Namespaced extension slot (cross-cutting cascade Task 9). Strategy-authored
     * metadata with no dedicated top-level field rides here and is forwarded
     * verbatim, one level deep. Declared on the public surface so a consumer can
     * READ the slot without casting — an extension slot nobody can reach through
     * the published types is only half a mechanism.
     *
     * Values are `unknown` by design: the slot's contract is that the engine
     * never interprets them. Narrow with a guard at the read site.
     */
    readonly extensions?: Readonly<Record<string, unknown>>
}

/**
 * How a finished run ended. Read this one field instead of combining
 * `success`, `terminatedBy` and `abstention`.
 *
 * - `"success"`: the run delivered. `success` is `true` exactly when the
 *   outcome is `"success"`.
 * - `"partial"`: the model wrote an answer, but the run fell short: it hit
 *   the iteration cap or a guard, a contract requirement stayed outstanding,
 *   a declared deliverable is missing, or a required tool never succeeded.
 *   `output` holds the draft; `error` says what fell short.
 * - `"failed"`: nothing usable was delivered (provider error, kernel failure,
 *   empty answer, verifier block). `output` is usually `""`; `error`
 *   carries the cause.
 * - `"abstained"`: the agent honestly declined instead of guessing.
 *   `output` is `""`; {@link AgentResult.abstention} says why and what was
 *   missing. Telemetry, debriefs and learning record it apart from failures.
 *
 * Reading a finished run:
 *
 * | outcome     | success | output             | where the detail is            |
 * | ----------- | ------- | ------------------ | ------------------------------ |
 * | `success`   | `true`  | the answer, or `""` when files are the answer | `receipt.deliverables` |
 * | `partial`   | `false` | the model's draft  | `error`, `metadata.outstandingCriteria` |
 * | `failed`    | `false` | usually `""`       | `error`                        |
 * | `abstained` | `false` | `""`               | `abstention.reason`, `abstention.missing` |
 *
 * The output is only ever the model's own answer. Files a run wrote are on
 * `receipt.deliverables`, never copied into `output`.
 */
export type AgentOutcome = "success" | "partial" | "failed" | "abstained"

/**
 * Result of a completed agent execution.
 *
 * Includes the final output, success status, task ID, and execution metadata
 * for full observability of what the agent did and how long it took.
 *
 * @example
 * ```typescript
 * const result = await agent.run("What is 2+2?");
 * console.log(result.output);           // "4"
 * console.log(result.success);          // true
 * console.log(result.metadata.duration); // 1250 (ms)
 * console.log(result.metadata.cost);    // 0.00123 (USD)
 * ```
 */
export interface AgentResult {
    /** The final output/answer produced by the agent. */
    readonly output: string
    /** Whether the execution completed successfully (true) or failed (false). */
    readonly success: boolean
    /**
     * How the run ended: `"success" | "partial" | "failed" | "abstained"`
     * (see {@link AgentOutcome} for the reading table). Present on every
     * finished run; absent while a durable run is paused (`status` says why).
     */
    readonly outcome?: AgentOutcome
    /**
     * The plan the run executed with each step's final status. Present on
     * `agent.execute(plan)` and on `agent.run(input, { plan })` when the plan has steps.
     */
    readonly plan?: Plan
    /** Unique ID for this execution task. */
    readonly taskId: string
    /** ID of the agent that performed the execution. */
    readonly agentId: string
    /** Metadata about the execution (duration, cost, tokens, strategy, steps). */
    readonly metadata: AgentResultMetadata
    /**
     * Deterministic trust receipt (Arc 1 Task 8) — graded evidence about HOW
     * this answer was produced (tool-call outcomes, termination reason,
     * abstention, verifier verdict when present). Computed from in-memory run
     * data at result assembly, so it is present even when tracing is off.
     *
     * NOT a truth certificate: `receipt.verdict` grades the run's evidence
     * trail, not the factual correctness of `output`. See {@link TrustReceipt}.
     */
    readonly receipt?: TrustReceipt
    /** Output format detected or declared by the agent. */
    readonly format?: OutputFormat
    /** How the agent loop was terminated. */
    readonly terminatedBy?: TerminatedBy
    /**
     * Whether the agent semantically achieved the task's goal.
     *
     * Distinct from {@link success} — `success` reflects whether the run
     * terminated cleanly (no exception, status === "done"), whereas
     * `goalAchieved` reflects whether the agent actually delivered an answer
     * it considered final.
     *
     * - `true` — agent produced a final answer (`terminatedBy` ∈ `{final_answer_tool, final_answer}`)
     * - `false` — agent exhausted iterations or errored (`terminatedBy` ∈ `{max_iterations, guard_stop, llm_error, abstained}`)
     * - `null` — goal achievement is ambiguous (`terminatedBy === "end_turn"` or unknown);
     *   the model finished its turn without explicitly signaling completion. Treat as "maybe".
     */
    readonly goalAchieved?: boolean | null
    /**
     * Run-level abstention surface — present iff `terminatedBy === "abstained"`.
     * The agent honestly declined rather than fabricating: `reason` is why,
     * `missing` lists what was needed (e.g. `"tool:web-search"`, a clarification).
     *
     * Distinct from the per-field structured-output `abstained` map below
     * (`.withOutputSchema({ abstainBelow })`), which is unrelated and may coexist.
     */
    readonly abstention?: { readonly reason: string; readonly missing: readonly string[] }
    /**
     * Structured post-run debrief. This is the INSTANT deterministic fallback —
     * available the moment `run()` returns (no LLM wait). The richer LLM-synthesized
     * debrief is produced off the critical path; await {@link debriefRich} for it.
     */
    readonly debrief?: AgentDebrief
    /**
     * Await the LLM-synthesized rich debrief, which the engine forks off the
     * critical path so it never delays the answer (measured ~4.7s/48% of a run).
     * Resolves to the rich debrief, or the deterministic fallback if no LLM
     * debrief was scheduled (trivial task / memory off / LLM unavailable).
     * Present only when a debrief was produced (reasoning path + `.withMemory()`).
     * The debrief call's own spend (outside `metadata.tokensUsed`) is `metrics.synthesisTokens`. */
    readonly debriefRich?: () => Promise<AgentDebrief | undefined>
    /** Error message when `success` is false. */
    readonly error?: string
    /** Typed structured output when `.withOutputSchema()` was set; undefined on parse-fail (lenient). */
    readonly object?: unknown
    /** Populated (lenient mode) when structured parse failed after retries. */
    readonly objectError?: string
    /**
     * How the extraction pipeline got `object` or why it failed: winning layer
     * (native, prompt, repaired, coerced, retried), attempts, JSON repairs,
     * coercion and field errors. Present whenever that pipeline ran. Absent
     * when the answer itself validated against the schema (no extraction call)
     * and for the grounded engine.
     */
    readonly objectReport?: import('@reactive-agents/core').StructuredOutputReport
    /** Grounded engine only: per-field-path evidence source. */
    readonly provenance?: Readonly<Record<string, { readonly source: string; readonly evidence: string }>>
    /** Grounded engine only: per-field-path confidence 0..1. */
    readonly confidence?: Readonly<Record<string, number>>
    /** Grounded engine only: per-field-path abstention reason (field omitted, not hallucinated). */
    readonly abstained?: Readonly<Record<string, string>>
    /** New evidence this run produced: the sum of its kernel assessments' `evidenceDelta` (0 = none). Absent when the run never assessed. */
    readonly evidenceDelta?: number
    /** Lifecycle status, absent on a normal run. A paused durable run is `"awaiting-approval"`/`"awaiting-interaction"`: not terminated, so no `terminatedBy`, and `success` is false. */
    readonly status?: "completed" | "awaiting-approval" | "awaiting-interaction" | "failed";
    /** The durable run id (`.withDurableRuns()` agents): the handle for `resumeRun` / `approveRun` / `listRuns`. Absent on non-durable runs. */
    readonly runId?: string;
    /** Set on a run started by `resumeRun(runId, { newRun: true })`: the run it continues (this result's `runId` is the new one). */
    readonly continuedFrom?: string;
    /** Set when a loop guard stopped the run: why, the tool it repeated, what was already done, what is unfinished. */
    readonly loopStop?: LoopStopSummary;
    /**
     * Set when a durable run did not complete (stopped or paused by the user, a
     * loop stop, a spent budget, a timeout, an error): its kind, what was done
     * and what was open. A user stop still carries the synthesized answer and
     * `success: true`; this is the truth that the run is unfinished.
     */
    readonly stop?: RunStopSummary;
    /** `true` when `agent.resumeRun(runId)` can continue this run (a durable run that did not complete and has a checkpoint). */
    readonly resumable?: boolean;
    /** Present only when `status === "awaiting-approval"`. The paused gate + the durable runId to approve/deny. */
    readonly pendingApproval?: {
        readonly runId: string;
        readonly gateId: string;
        readonly toolName: string;
        readonly args: unknown;
    };
    /**
     * Agentic-UI interaction rail (Task 10): present only when
     * `status === "awaiting-interaction"`. The paused interaction + the durable
     * runId to `respondToInteraction`.
     */
    readonly pendingInteraction?: {
        readonly runId: string;
        readonly interactionId: string;
        readonly kind: string;
        readonly prompt: string;
        readonly schema: unknown;
    };
}
