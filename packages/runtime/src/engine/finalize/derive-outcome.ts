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
    // `toolCalls`/`deliverables` are returned (not just consumed internally
    // for `goalAchieved`/`receipt`) because they're the receipt-flavored
    // evidence a later task in this plan may want to read directly at the
    // call sites — neither `reactive-agent.ts` nor `execute-stream.ts` reads
    // them off `TaskOutcome` post-extraction today (both already had their
    // own separate derivations for other purposes, e.g. `AgentResultMetadata.toolCalls`
    // in reactive-agent.ts, which this does NOT replace).
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
    /**
     * True when the run paused for approval/interaction before this
     * `TaskResult` became terminal. Forces `deliverables` to `undefined`
     * (a paused run's artifact scan is incomplete — the RunContract's
     * declared deliverables cannot yet be graded produced/missing), which
     * in turn makes `goalAchieved` fall back to the pure `terminatedBy`
     * heuristic — typically `null` (ambiguous) for a still-paused run,
     * since it usually has no `terminatedBy` yet. Restores the
     * pre-extraction behavior, where `receiptDeliverables` was
     * force-`undefined` on the pause branch BEFORE `goalAchieved` was
     * computed from it (not just before the receipt was assembled).
     * Callers additionally suppress the returned `receipt` field
     * themselves on a paused run — see each call site's `isPausedRun`
     * guard — since a receipt belongs to a TERMINAL result only.
     */
    readonly isPausedRun?: boolean
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
 * A paused run (approval-gate / awaiting-interaction) is unfinished, so a
 * receipt belongs to a TERMINAL result only — grading it now would stamp a
 * misleading verdict, and the resumed run produces its own receipt on
 * completion. Pass `ctx.isPausedRun` so this function suppresses
 * `deliverables` (and, transitively, `goalAchieved`'s deliverable-evidence
 * upgrade) itself — see `DeriveTaskOutcomeCtx.isPausedRun`'s JSDoc. Callers
 * additionally suppress the returned `receipt` field on a paused run at the
 * call site (mirrored in both `reactive-agent.ts` and `execute-stream.ts`).
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
    //
    // Forced `undefined` on a paused run (`ctx.isPausedRun`) — a paused
    // run's artifact scan is incomplete, so the RunContract's declared
    // deliverables cannot yet be graded produced/missing. This must happen
    // BEFORE `goalAchieved` below, not just before the receipt is
    // assembled: computing real deliverables here for a paused run would
    // let `resolveGoalAchieved` see "declared but not yet produced" and
    // return a definitive `false` instead of the correct ambiguous `null`
    // — a paused run isn't a failed one.
    const deliverables = ctx.isPausedRun
        ? undefined
        : deriveReceiptDeliverables({
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
        // Both call sites always pass an already-resolved `deriveReceiptModelId(...)`
        // string, so this fallback is defensive (keeps the function total for
        // callers that omit `ctx.modelId`, e.g. the unit test) rather than a
        // path either call site is expected to hit in practice.
        modelId: ctx.modelId ?? 'claude-sonnet-4-6',
        ...(ctx.configHash !== undefined ? { configHash: ctx.configHash } : {}),
        ...(ctx.forkedFrom !== undefined ? { forkedFrom: ctx.forkedFrom } : {}),
        now: ctx.now ?? Date.now(),
    })

    return { toolCalls, deliverables, goalAchieved, receipt }
}
