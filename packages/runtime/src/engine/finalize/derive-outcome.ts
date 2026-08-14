import type { TaskResult, TaskContract, TerminatedBy, TrustReceipt } from '@reactive-agents/core'
import { computeTrustReceipt, deriveInterventionsFromSteps } from '@reactive-agents/core'
import {
    resolveGoalAchieved,
    deriveReceiptToolCalls,
    deriveReceiptDeliverables,
} from '../../builder/helpers.js'
import type { ReasoningStep } from '@reactive-agents/reasoning'
import type { RunLedgerEntryShape } from '../../types.js'

/**
 * Terminal outcome of a completed run — the single computed answer to "what
 * happened" that both `reactive-agent.ts`'s `run()` and
 * `execute-stream.ts`'s `runStream()` surface to callers. Extracted
 * (FM-4 part 1, 2026-08-13) from two independently-obtained `TaskResult`
 * blocks that called the same four helpers in the same sequence but had no
 * shared owner, so the two computations could silently diverge even though
 * the underlying algorithm was identical. See `deriveTaskOutcome`'s JSDoc.
 */
export interface TaskOutcome {
    readonly toolCalls: ReturnType<typeof deriveReceiptToolCalls>
    readonly deliverables: ReturnType<typeof deriveReceiptDeliverables>
    readonly goalAchieved: boolean | null
    readonly receipt: TrustReceipt
}

/** Inputs `deriveTaskOutcome` needs beyond the `TaskResult` itself — the
 * pieces each call site already has on hand from its own config/task, not
 * derivable from the result alone. */
export interface DeriveTaskOutcomeCtx {
    /** The original task/question text (RunContract compilation input). */
    readonly task: string
    readonly requiredTools?: readonly string[]
    readonly taskContract?: TaskContract
    /** Resolved via `deriveReceiptModelId` at the call site (different config
     * shapes between `run()`'s builder config and `runStream()`'s
     * `ReactiveAgentsConfig`) — pass the already-resolved string here. */
    readonly modelId?: string
    /** Injection point for `Date.now()` so this stays a pure function of its
     * inputs (see the unit test — same input must give the same output). */
    readonly now?: number
    /** Durable-resume config hash (`run()` only) — passed through verbatim
     * onto the receipt, does not affect verdict/confidence. */
    readonly configHash?: string
    /** Fork lineage (`run()` only, `options.forkedFrom`) — passed through
     * verbatim onto the receipt, does not affect verdict/confidence. */
    readonly forkedFrom?: string
}

/**
 * Single owner of "what is the terminal outcome" for a completed `TaskResult`.
 *
 * Lifted verbatim (extraction, not a rewrite) from the identical sequence
 * both `reactive-agent.ts:1499-1609` and `execute-stream.ts:646-690`
 * independently ran: `deriveReceiptDeliverables` → `resolveGoalAchieved` →
 * `deriveReceiptToolCalls` → `deriveInterventionsFromSteps` →
 * `computeTrustReceipt`. Both call sites now call this ONE function instead
 * of re-deriving the same four helpers on their own locally-obtained
 * `TaskResult`, so the two paths can no longer silently disagree about
 * whether the run achieved its goal or how the receipt reads.
 *
 * Callers own the PAUSED-run check: a receipt belongs to a TERMINAL result
 * only (a run paused for approval/interaction is unfinished — grading it now
 * would stamp a misleading verdict, and the resumed run produces its own
 * receipt on completion). This function assumes it is only called on
 * terminal results; see the `isPausedRun` guards at each call site.
 */
export function deriveTaskOutcome(taskResult: TaskResult, ctx: DeriveTaskOutcomeCtx): TaskOutcome {
    const r = taskResult as TaskResult & {
        readonly terminatedBy?: TerminatedBy
        readonly metadata: {
            readonly reasoningSteps?: readonly ReasoningStep[]
            readonly runLedger?: ReadonlyArray<RunLedgerEntryShape>
            readonly cacheHit?: boolean
            readonly verifierVerdict?: string
            readonly receiptToolCalls?: ReadonlyArray<{ readonly name: string; readonly ok: boolean }>
        }
    }
    const rawMetadata = r.metadata

    // B2 (meta-loop 4a): declared deliverables × produced-status, computed
    // from the run's RunContract (recompiled here from the same task inputs)
    // × the reasoning-step artifact scan. A partial multi-file run names its
    // missing files on the receipt.
    const deliverables = deriveReceiptDeliverables({
        task: ctx.task,
        ...(ctx.requiredTools ? { requiredTools: ctx.requiredTools } : {}),
        ...(ctx.taskContract !== undefined ? { taskContract: ctx.taskContract } : {}),
        reasoningSteps: rawMetadata.reasoningSteps,
        // Wave C1 (task 6) — same forwarded ledger deriveReceiptToolCalls
        // reads below; a ledger `artifact` entry marks a declared
        // deliverable produced without re-scanning reasoningSteps.
        runLedger: rawMetadata.runLedger,
        output: String(r.output ?? ''),
    })

    // Deterministic upgrade over the terminatedBy heuristic: the
    // declared-deliverable evidence resolves end_turn's "maybe" (see
    // resolveGoalAchieved's JSDoc, builder/helpers.ts).
    const goalAchieved = resolveGoalAchieved(r.terminatedBy, deliverables)

    const toolCalls = deriveReceiptToolCalls(rawMetadata)

    const receipt = computeTrustReceipt({
        toolCalls,
        ...(deliverables !== undefined ? { deliverables } : {}),
        // Spec §5b — harness interventions recorded on the reasoning steps
        // become a receipt surface.
        ...((): { interventions?: readonly import('@reactive-agents/core').InterventionReceipt[] } => {
            const iv = deriveInterventionsFromSteps(rawMetadata.reasoningSteps)
            return iv.length > 0 ? { interventions: iv } : {}
        })(),
        ...(r.terminatedBy !== undefined ? { terminatedBy: r.terminatedBy } : {}),
        // Result-boundary verification — the verifier reaches EVERY path, so
        // this field has a writer outside the react kernel.
        ...(rawMetadata.verifierVerdict !== undefined ? { verifierVerdict: rawMetadata.verifierVerdict } : {}),
        // A semantic-cache hit short-circuits the loop: no LLM call, no
        // tools, no steps. The receipt says so rather than letting a replay
        // read like an ordinary run.
        replayed: rawMetadata.cacheHit === true,
        goalAchieved,
        abstained: r.terminatedBy === 'abstained',
        success: r.success ?? true,
        modelId: ctx.modelId ?? 'claude-sonnet-4-6',
        ...(ctx.configHash !== undefined ? { configHash: ctx.configHash } : {}),
        ...(ctx.forkedFrom !== undefined ? { forkedFrom: ctx.forkedFrom } : {}),
        now: ctx.now ?? Date.now(),
    })

    return { toolCalls, deliverables, goalAchieved, receipt }
}
