/**
 * Module-level helper functions used by builder.ts and the runtime
 * agent. Pure functions with no closure dependencies on the builder
 * class.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { Effect, type Context } from 'effect'
import type { DeliverableReceipt, TaskContract, TerminatedBy } from '@reactive-agents/core'
import { getProviderDefaultModel } from '@reactive-agents/llm-provider'
import { META_TOOLS, HARNESS_PSEUDO_TOOLS, ABSTAIN_TOOL_NAME, compileRunContract, computeDeliverableReport, type ReasoningStep } from '@reactive-agents/reasoning'
import { REQUEST_USER_INPUT_TOOL_NAME } from '@reactive-agents/tools'
import type { AgentPersona } from './types.js'

/**
 * Resolve a Context.Tag from the surrounding Effect runtime, returning the
 * service typed as its declared interface (rather than `unknown`).
 *
 * Use at gateway/builder boundary call sites that previously did
 * `yield* SomeService as any` because the dep interface only knows the
 * service as `unknown`. The returned Effect requires the service in its R
 * channel exactly the same way `yield* tag` does, so type erasure is local
 * to the consumer — the surrounding runtime contract is unchanged.
 *
 * @example
 * ```ts
 * const gw = yield* yieldService(GatewayService)
 * yield* gw.processEvent(event) // typed
 * ```
 */
export const yieldService = <I, S>(
    tag: Context.Tag<I, S>
): Effect.Effect<S, never, I> =>
    Effect.gen(function* () {
        return yield* tag
    })

/**
 * Resolve the default tracing config (Sprint 3.6).
 *
 * Tracing is **on by default** so `rax diagnose <runId>` always has a JSONL
 * file to inspect. Users disable explicitly via `.withoutTracing()` on the
 * builder or `REACTIVE_AGENTS_TRACE=off` in the env (the env switch covers
 * CI, container, or one-off scripted runs that shouldn't write to disk).
 *
 * Default location is `~/.reactive-agents/traces` so multiple agents in the
 * same workspace don't pollute the project directory.
 */
export function defaultTracingConfig(): { dir: string } | null {
  const envFlag = (process.env.REACTIVE_AGENTS_TRACE ?? "").toLowerCase()
  if (envFlag === "off" || envFlag === "false" || envFlag === "0") return null
  const customDir = process.env.REACTIVE_AGENTS_TRACE_DIR
  if (customDir && customDir.length > 0) return { dir: customDir }
  return { dir: join(homedir(), ".reactive-agents", "traces") }
}

/**
 * Derive the `goalAchieved` signal from the kernel's `terminatedBy` value.
 *
 * See {@link AgentResult.goalAchieved} for semantics.
 */
export function deriveGoalAchieved(terminatedBy: TerminatedBy | undefined): boolean | null {
    switch (terminatedBy) {
        case "final_answer_tool":
        case "final_answer":
            return true
        case "max_iterations":
        case "llm_error":
        case "abstained":
            return false
        case "end_turn":
        case undefined:
            return null
    }
}

/**
 * Whether a tool name counts as SUBSTANTIVE grounding evidence for the trust
 * receipt (Arc 1 Task 8). Excluded, per the kernel's own "not real work"
 * classification (live-smoke defect fix 2026-07-06):
 *
 * - `META_TOOLS` (kernel-constants.ts, the single source of truth): harness
 *   inline tools — final-answer, task-complete, context-status, brief, pulse,
 *   find, recall, checkpoint, activate-skill, discover-tools,
 *   write_result_to_file. EVERY kernel run terminates via `final-answer`, so
 *   counting it made verdict "ungrounded" unreachable on the kernel path and
 *   graded pure-knowledge answers "tool-grounded" — inverting the receipt's
 *   whole purpose.
 * - `HARNESS_PSEUDO_TOOLS` (same file): harness-injected observation
 *   pseudo-names (system, completion-guard, abstention-legitimacy). Its JSDoc
 *   documents this exact masking hazard for the kernel's own grounded-terminal
 *   invariant; excluded here defensively (they never appear as action
 *   `toolCall` names or ToolCallCompleted events today).
 * - `ABSTAIN_TOOL_NAME` ("abstain", meta-tool-handlers.ts — NOT in
 *   META_TOOLS): termination meta-tool. Safe to exclude: verdict rule 1
 *   (abstained) is driven by `terminatedBy === "abstained"`, never by
 *   toolCalls.
 * - `REQUEST_USER_INPUT_TOOL_NAME` ("request_user_input", tools pkg): the
 *   interaction PAUSE tool — paused runs never grade (receipt suppressed),
 *   but a resumed-then-completed run's steps can still contain it.
 *
 * All names import from their owning packages — no hardcoded copies to drift.
 */
const isSubstantiveReceiptTool = (name: string): boolean =>
    !META_TOOLS.has(name) &&
    !HARNESS_PSEUDO_TOOLS.has(name) &&
    name !== ABSTAIN_TOOL_NAME &&
    name !== REQUEST_USER_INPUT_TOOL_NAME

/**
 * Derive `{name, ok}` tool-call outcomes for the trust receipt (Arc 1 Task 8)
 * from a run's result metadata. Meta/termination/pseudo tools are excluded at
 * BOTH sources (see {@link isSubstantiveReceiptTool}) — only substantive
 * calls are grounding evidence. Two sources, in preference order:
 *
 * 1. `reasoningSteps` (kernel path) — pairs each `action` step's
 *    `metadata.toolCall.id` with the `observation` step carrying the matching
 *    `metadata.toolCallId`, reading `metadata.observationResult.success` as
 *    the ok/fail signal (see `packages/reasoning/.../act/tool-observe.ts` and
 *    `act.ts`, which both stamp this exact shape on every tool call). Steps
 *    are preferred because they also cover calls that never reached the
 *    ToolCallCompleted event (e.g. allowedTools-blocked calls become a
 *    failed action/observation pair).
 * 2. `receiptToolCalls` (fallback) — `{name, ok}` outcomes forwarded by
 *    execution-engine.ts from its ToolCallCompleted event log. This is the
 *    ONLY source on the minimal/inline loop, which executes tools but
 *    produces no reasoningSteps — without it, tool-using minimal runs would
 *    falsely grade "ungrounded".
 *
 * An action step with no resolvable observation pairing (e.g. the run was
 * interrupted mid-call) is conservatively treated as failed rather than
 * dropped, so `toolCallStats` still accounts for every attempted call.
 */
/**
 * Compute the receipt's `deliverables[]` (meta-loop 4a / B2) — the declared
 * deliverables × produced-status. Compiles the run's RunContract from the SAME
 * task inputs the kernel used (task prose + required tools + declared
 * TaskContract; deterministic, DAG-clean) and verifies each deliverable against
 * the run's reasoning steps with the pure `computeDeliverableReport` gate. A
 * partial multi-file run (rw-8: 1 of 3) names the two missing files here.
 *
 * Returns `undefined` when the contract declares no deliverable (pure Q&A) — the
 * caller then leaves `receipt.deliverables` absent, so those receipts stay
 * byte-identical to v1.
 */
export function deriveReceiptDeliverables(args: {
    readonly task: string
    readonly requiredTools?: readonly string[]
    readonly taskContract?: TaskContract
    readonly reasoningSteps?: readonly ReasoningStep[]
    readonly output: string
}): readonly DeliverableReceipt[] | undefined {
    const contract = compileRunContract(args.task, {
        ...(args.requiredTools ? { requiredTools: args.requiredTools } : {}),
        ...(args.taskContract ? { taskContract: args.taskContract } : {}),
    })
    if (contract.deliverables.length === 0) return undefined
    const report = computeDeliverableReport(contract, args.reasoningSteps ?? [], args.output)
    return report.length > 0 ? report : undefined
}

export function deriveReceiptToolCalls(
    metadata: {
        readonly reasoningSteps?: ReadonlyArray<{
            readonly type: string
            readonly metadata?: Record<string, unknown>
        }>
        readonly receiptToolCalls?: ReadonlyArray<{
            readonly name: string
            readonly ok: boolean
        }>
    } | undefined
): ReadonlyArray<{ readonly name: string; readonly ok: boolean }> {
    const fromSteps = deriveFromSteps(metadata?.reasoningSteps)
    if (fromSteps.length > 0) return fromSteps
    return (metadata?.receiptToolCalls ?? []).filter((tc) =>
        isSubstantiveReceiptTool(tc.name),
    )
}

function deriveFromSteps(
    reasoningSteps: ReadonlyArray<{
        readonly type: string
        readonly metadata?: Record<string, unknown>
    }> | undefined
): ReadonlyArray<{ readonly name: string; readonly ok: boolean }> {
    if (!reasoningSteps || reasoningSteps.length === 0) return []

    const okByCallId = new Map<string, boolean>()
    for (const step of reasoningSteps) {
        if (step.type !== "observation") continue
        const callId = step.metadata?.toolCallId
        const observationResult = step.metadata?.observationResult as
            | { success?: boolean }
            | undefined
        if (typeof callId === "string" && typeof observationResult?.success === "boolean") {
            okByCallId.set(callId, observationResult.success)
        }
    }

    const result: Array<{ name: string; ok: boolean }> = []
    for (const step of reasoningSteps) {
        if (step.type !== "action") continue
        const toolCall = step.metadata?.toolCall as
            | { id?: string; name?: string }
            | undefined
        if (!toolCall?.name) continue
        // Meta/termination/pseudo tools are not grounding evidence — see
        // isSubstantiveReceiptTool (live-smoke defect: final-answer counted).
        if (!isSubstantiveReceiptTool(toolCall.name)) continue
        const ok = typeof toolCall.id === "string" ? okByCallId.get(toolCall.id) ?? false : false
        result.push({ name: toolCall.name, ok })
    }
    return result
}

/**
 * Resolve the `modelId` stamped on a TrustReceipt (Arc 1 Task 8) — the SINGLE
 * source used by BOTH receipt-assembly sites (`reactive-agent.ts`
 * buildRunTaskEffect and `engine/execute-stream.ts`), so the same run can
 * never carry different `receipt.modelId` values across `.run()` vs
 * `.runStream()`.
 *
 * Mirrors `createRuntime`'s model-resolution chain (runtime.ts:263-269)
 * exactly: explicit model > `LLM_DEFAULT_MODEL` env > provider registry
 * default > the same hardcoded final fallback. The stream site passes the
 * already-resolved `config.defaultModel` (first branch returns it verbatim);
 * the non-stream site passes the raw builder `_model` + provider and walks
 * the identical chain — converging on the same value by construction.
 */
export function deriveReceiptModelId(model: unknown, provider: unknown): string {
    if (typeof model === 'string' && model.length > 0) return model
    const envModel = process.env.LLM_DEFAULT_MODEL
    if (envModel !== undefined && envModel.length > 0) return envModel
    if (typeof provider === 'string' && provider.length > 0) {
        const providerDefault = getProviderDefaultModel(provider)
        if (providerDefault !== undefined && providerDefault.length > 0) return providerDefault
    }
    return 'claude-sonnet-4-6'
}

// ─── Persona Composition Helper ───────────────────────────────────────────────

/**
 * Compose an AgentPersona into a structured system prompt.
 *
 * Builds a multi-section prompt with Role, Background, Instructions, and Tone (if provided).
 * Empty sections are omitted. This is used internally during agent build to merge persona
 * configuration with explicit system prompts.
 *
 * @param persona - The agent persona to compose
 * @param agentName - Name of the agent (for logging/reference, not included in output)
 * @returns A formatted system prompt string with persona sections
 */
export function composePersonaToSystemPrompt(
    persona: AgentPersona,
    agentName: string
): string {
    const sections: string[] = []

    // Role (required-ish for personas, but we'll include if set)
    if (persona.role) {
        sections.push(`Role: ${persona.role}`)
    }

    // Background
    if (persona.background) {
        sections.push(`Background: ${persona.background}`)
    }

    // Instructions
    if (persona.instructions) {
        sections.push(`Instructions: ${persona.instructions}`)
    }

    // Tone
    if (persona.tone) {
        sections.push(`Tone: ${persona.tone}`)
    }

    return sections.join('\n\n')
}

/**
 * Compose a final sub-agent system prompt by merging an optional persona
 * with an optional explicit `systemPrompt`.
 *
 * Wraps the duplicated pattern previously inlined at:
 *   - `builder.ts` (root agent factory)
 *   - `builder/build-effect/local-agent-tools.ts` (local sub-agent registration)
 *   - `builder/build-effect/sub-agent-executor.ts` (dynamic sub-agent executor)
 *
 * Semantics (preserved exactly from the 3 prior call sites):
 *   - No persona → return `systemPrompt` unchanged (may be `undefined`).
 *   - Persona + systemPrompt → `${personaPrompt}\n\n${systemPrompt}`.
 *   - Persona only → return the composed persona prompt alone.
 *
 * @param persona - Optional persona to compose; if absent, the system prompt is returned as-is.
 * @param systemPrompt - Optional explicit system prompt to append after the persona section.
 * @param agentName - Agent name forwarded to `composePersonaToSystemPrompt` (for logging/reference).
 */
export function buildSubAgentSystemPrompt(
    persona: AgentPersona | undefined,
    systemPrompt: string | undefined,
    agentName: string
): string | undefined {
    if (!persona) return systemPrompt
    const personaPrompt = composePersonaToSystemPrompt(persona, agentName)
    return systemPrompt
        ? `${personaPrompt}\n\n${systemPrompt}`
        : personaPrompt
}
