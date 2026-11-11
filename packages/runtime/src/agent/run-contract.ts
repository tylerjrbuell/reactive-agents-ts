/**
 * `run()`'s bare-builder failure contract.
 *
 * Extracted verbatim from `ReactiveAgent.run()`.
 *
 * B1 (Move 1 merge, 2026-08-12/13): the kernel arm resolves an
 * infrastructure/exhaustion failure — a provider fault
 * (terminatedBy:"llm_error") or running out of budget without
 * completing (terminatedBy:"max_iterations") — as a graceful
 * status:"failed" result instead of an Effect failure.
 * `.withReasoning()` users have ALWAYS gotten this — it is the
 * kernel's existing, deliberately-tested contract
 * (error-reporting.test.ts: "hard LLM failure surfaces as
 * success:false"; agent-config.test.ts's maxIterations cases). The
 * BARE builder's old inline arm instead let both classes of
 * failure propagate uncaught, so run() REJECTED and
 * withErrorHandler fired (tool-loop-behavioral.test.ts: "error turn
 * causes agent.run() to throw", "agent exceeds max iterations when
 * tool calls never terminate"). Move 1 routes bare builders through
 * the same kernel arm, which would silently flip that public
 * contract for every bare-builder caller. Preserve it explicitly —
 * only a bare builder (no explicit .withReasoning()) re-throws.
 * 
 * Deliberately NOT extended to every success:false reason: semantic
 * judgment failures (abstention, fabrication-guard rejection, empty
 * output with no verified deliverable) are the agent COMPLETING and
 * being graded, not the agent failing to run — those stay
 * success:false without a throw on both bare and explicit builders
 * (engine-empty-output-invariant.test.ts, abstention-is-not-success
 * .test.ts, fabrication-guard-rail.test.ts, verification-outcome
 * .test.ts — all bare, none expect a throw). Only extend this list
 * with another terminatedBy value if a bare-builder test explicitly
 * documents the old inline arm throwing for it.
 *
 * `guard_stop` (2026-11-04) is not a new class: it is the public label
 * split out of `max_iterations` for a failed run a harness guard (loop
 * detection, stall, low progress, strategy-switch exhaustion) stopped
 * before the cap. Those runs were reported as `max_iterations` and threw
 * on a bare builder; listing it keeps that contract unchanged.
 */
import {
    ExecutionError,
    KillSwitchTriggeredError,
    toRunBoundaryError,
    unwrapError,
    unwrapErrorWithSuggestion,
    type RuntimeErrors,
} from '../errors.js'
import type { AgentResult } from '../builder/types.js'
import { Effect, type ManagedRuntime } from 'effect'
import { EventBus, emitErrorSwallowed, errorTag, type AgentEvent } from '@reactive-agents/core'

/**
 * Publish AgentTerminated for a mid-flight abort. The engine only emits this
 * at a phase boundary; when terminate() interrupts an in-flight LLM call the
 * boundary check never runs, so run() emits it here to keep event parity.
 * (Moved from `ReactiveAgent.emitAgentTerminated`.)
 */
export const publishAgentTerminated = (
    runtime: ManagedRuntime.ManagedRuntime<unknown, never>,
    agentId: string,
    taskId: string,
    reason: string,
): Promise<void> =>
    runtime.runPromise(
        EventBus.pipe(
            Effect.flatMap((eb) =>
                eb.publish({
                    _tag: 'AgentTerminated' as const,
                    agentId,
                    taskId,
                    reason,
                } as AgentEvent),
            ),
            Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/reactive-agent.ts:emitTerminated", tag: errorTag(err) })),
        ) as Effect.Effect<void>,
    )

/** One run's AgentTerminated emitter: armed on the run signal, emits at most once. */
export interface AbortTerminal {
    /** Publish AgentTerminated for this run unless already published. */
    readonly emit: (taskId: string) => Promise<void>
    /** Remove the abort listener (the kill-switch signal outlives the run). */
    readonly disarm: () => void
}

/**
 * Publish AgentTerminated the moment terminate() aborts the run signal, while
 * terminate() itself is still running. A caller that does
 * `await agent.terminate(); await agent.dispose()` then still sees the event:
 * waiting for the run's rejection to reach `mapRunBoundaryError` would publish
 * on a runtime the caller may already have disposed. The boundary path calls
 * `emit` too (a signal already aborted before the run started); the once-guard
 * keeps the event single.
 */
export const armAbortTerminal = (args: {
    readonly signal: AbortSignal | undefined
    readonly taskId: string | undefined
    readonly publish: (taskId: string) => Promise<void>
}): AbortTerminal => {
    let published: Promise<void> | undefined
    const emit = (taskId: string): Promise<void> => (published ??= args.publish(taskId))
    // Fire-and-forget inside an abort listener: a publish failure must not
    // surface as an unhandled rejection (publishAgentTerminated already
    // routes Effect failures to emitErrorSwallowed).
    const onAbort = (): void => void emit(args.taskId ?? 'unknown').catch(() => undefined)
    if (args.signal && !args.signal.aborted) args.signal.addEventListener('abort', onAbort, { once: true })
    return { emit, disarm: () => args.signal?.removeEventListener('abort', onAbort) }
}

/** `terminatedBy` values a bare builder (no explicit `.withReasoning()`) re-throws. */
export const BARE_BUILDER_THROWS_ON: ReadonlySet<string> = new Set(['llm_error', 'max_iterations', 'guard_stop'])

/**
 * The error `run()` must throw for `result`, or `undefined` when the result
 * resolves normally (explicit-reasoning builders and all non-listed reasons).
 */
export const bareBuilderFailure = (
    result: AgentResult,
    enableReasoning: boolean,
): ExecutionError | undefined =>
    result.terminatedBy !== undefined &&
    BARE_BUILDER_THROWS_ON.has(result.terminatedBy) &&
    !enableReasoning
        ? new ExecutionError({
              message: result.error ?? `Agent run failed: ${result.terminatedBy}`,
              taskId: result.taskId,
              phase: 'execution',
          })
        : undefined

type ApprovalDecision = boolean | { approve: boolean; reason?: string }

/**
 * Tier 2 same-process approval driver: while the run is `awaiting-approval`,
 * ask `onApproval` and resume (approve) or deny. Loops so multi-gate runs (a
 * resume that pauses again) are handled. Without a callback the result is
 * returned untouched (the caller resolves pauses out of band).
 */
export const driveApprovals = async (
    initial: AgentResult,
    onApproval:
        | ((pending: NonNullable<AgentResult['pendingApproval']>) => ApprovalDecision | Promise<ApprovalDecision>)
        | undefined,
    actions: {
        readonly approve: (runId: string) => Promise<AgentResult>
        readonly deny: (runId: string, reason: string) => Promise<AgentResult>
    },
): Promise<AgentResult> => {
    let result = initial
    while (onApproval && result.status === 'awaiting-approval' && result.pendingApproval) {
        const decision = await onApproval(result.pendingApproval)
        const approve = typeof decision === 'boolean' ? decision : decision.approve
        const reason = typeof decision === 'object' ? decision.reason : undefined
        result = approve
            ? await actions.approve(result.pendingApproval.runId)
            : await actions.deny(result.pendingApproval.runId, reason ?? 'denied by onApproval')
    }
    return result
}

/**
 * Translate any error escaping `run()` into its public boundary error.
 *
 * - `terminate()` aborted the fiber mid-flight: the engine's phase-boundary
 *   lifecycle check never ran, so emit AgentTerminated here (parity with the
 *   phase-boundary terminate branch) and surface a clean terminal error rather
 *   than the raw interruption.
 * - Otherwise hand the full unwrapped error to the user's `errorHandler` (its
 *   own exceptions are swallowed — never replace the original error) and throw
 *   a one-line boundary error. The suggestion is appended to a SEPARATE
 *   instance so programmatic `error.message === "..."` checks on the handler's
 *   copy are undisturbed.
 */
export const mapRunBoundaryError = async (
    e: unknown,
    ctx: {
        readonly agentId: string
        readonly taskId: string | undefined
        readonly aborted: boolean
        readonly emitTerminated: (taskId: string) => Promise<void>
        readonly errorHandler:
            | ((error: RuntimeErrors | Error, context: { taskId: string; phase: string; iteration: number }) => void)
            | undefined
    },
): Promise<never> => {
    if (ctx.aborted) {
        const tid = ctx.taskId ?? 'unknown'
        await ctx.emitTerminated(tid)
        throw toRunBoundaryError(
            new KillSwitchTriggeredError({
                message: `Agent ${ctx.agentId} terminated`,
                taskId: tid,
                agentId: ctx.agentId,
                reason: 'terminate() called',
            }),
        )
    }
    if (ctx.errorHandler) {
        try {
            ctx.errorHandler(unwrapError(e) as RuntimeErrors | Error, {
                taskId: 'unknown',
                phase: 'execution',
                iteration: 0,
            })
        } catch {
            // Handler exceptions are silently ignored — never replace the original error
        }
    }
    throw toRunBoundaryError(unwrapErrorWithSuggestion(e))
}
