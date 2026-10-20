/**
 * Harness-mode / durable-run / contract / execution-bound withers for ReactiveAgentBuilder
 * (2026-10-20 builder decomp, GH #218 / HS-248).
 *
 * Class methods on the builder are thin delegates that mutate state via these
 * helpers and return `this` for chaining; public-contract JSDoc moved verbatim.
 */
import type { TaskContract } from '@reactive-agents/core'
import type { BuilderState } from './_state.js'

/**
 * Opt in to the **long-horizon guard profile** (off by default). A mode
 * toggle — no arguments; the kernel scales its audit-02-#12 guard constants
 * proportionally to `maxIterations` (via `resolveHorizonProfile`) instead of
 * using absolute counts, so a run configured for ≥40 iterations of
 * tool-using work is not tripped by guards tuned for short runs.
 *
 * Flows through to `KernelRunOptions.horizonProfile = "long"` (read by the
 * reasoning kernel). Zero cost when not called: `horizonProfile` stays unset
 * and behaviour is byte-identical to today.
 *
 * Forward note: the Phase 6 policy compiler (plan G1) will subsume this
 * wither — the `horizonProfile` config field is the durable interface.
 *
 * @returns `this` for chaining
 */
export const applyWithLongHorizon = (state: BuilderState, ) => {
    state._longHorizon = true
}


/**
 * Opt in to the **adaptive harness** (off by default) — the Phase 6 policy
 * compiler (plan G1). A mode toggle, no arguments. When enabled, the kernel
 * compiles a single `HarnessPlan` at run-start from what the run KNOWS about
 * itself (the model's capability tier + calibration, the compiled contract's
 * horizon, and the task classification): strategy, budget class, guard/horizon
 * profile, tool surface, memory posture. The plan supplies the
 * DEFAULTS; any explicit wither you set (`.withStrategy`, `.withLongHorizon`,
 * budget withers, …) OVERRIDES the corresponding plan field. Mid-run, the plan
 * is recompiled on live progress evidence — DEEPENING scaffolding when the run
 * struggles (repeated failures / no new evidence) and LEANING when it flows —
 * each recompile recorded as a ledger `harness-signal`.
 *
 * `horizonProfile` becomes a plan output: the compiler sets it to "long" when
 * `contract.horizon === "long"`; `.withLongHorizon()` still forces it on.
 *
 * Flows through to `KernelRunOptions.adaptiveHarness = true`. Zero cost when
 * not called: no plan is compiled and the config path is byte-identical.
 *
 * @returns `this` for chaining
 */
export const applyWithAdaptiveHarness = (state: BuilderState, ) => {
    state._adaptiveHarness = true
}


/**
 * Opt in to cost-aware model routing (off by default). Routes each run to
 * the cheapest CAPABLE model of the configured provider, picked by task
 * complexity. Stays within the provider's tiers; degrades to the configured
 * model on any routing error.
 * @returns `this` for chaining
 */
export const applyWithModelRouting = (state: BuilderState, options: import('../types.js').ModelRoutingOptions = {}) => {
    state._modelRouting = options
}


/**
 * Opt in to durable run persistence (off by default).
 *
 * When enabled, the runtime generates a stable `runId` for each run,
 * records it in a SQLite `RunStore` (`runs.db` under `dir`, default
 * `~/.reactive-agents/<agentId>/`), and persists a lossless serialized
 * kernel-state snapshot every `checkpointEvery` iterations (default 1).
 * Writes are fire-and-forget — they never block or fail the run. This is
 * the write half of crash-resume; Phase C's `resume(runId)` reads these
 * checkpoints back. Zero cost when not called: no store, no run row, no
 * db file.
 *
 * @param options - Durable run configuration
 * @param options.dir - Directory for the runs.db SQLite file. Default: ~/.reactive-agents/<agentId>/
 * @param options.checkpointEvery - Persist a checkpoint every N iterations. Default: 1
 * @returns `this` for chaining
 */
export const applyWithDurableRuns = (state: BuilderState, options?: import('../types.js').DurableRunsOptions) => {
    state._durableRuns = options ?? {}
}


/**
 * Agentic-UI (Task 11): enable agent-initiated user interaction. When set, the
 * model may call `request_user_input` to pause the run durably and ask the
 * human for a form / choice / confirmation; `respondToInteraction` resumes it.
 * Requires `.withDurableRuns()` — interaction pauses persist to the durable
 * store. Zero cost when not called.
 *
 * @returns `this` for chaining
 */
export const applyWithUserInteraction = (state: BuilderState, ) => {
    state._userInteraction = true
}


/**
 * Configure durable human-in-the-loop approval gates (Phase D).
 *
 * In `mode: "detach"` (the default when `.withDurableRuns()` is set), a tool
 * call named in `tools` — or matched by `requireFor` — pauses the run on the
 * `runStream()` path: the engine persists `awaiting-approval` plus the pending
 * action and the stream completes with `pendingApproval`. A human then calls
 * `agent.approveRun(runId)` / `agent.denyRun(runId, reason)` from ANY process,
 * which resumes the run from its checkpoint to completion.
 *
 * `mode: "detach"` requires `.withDurableRuns()` (detached pauses need a
 * durable store).
 *
 * `mode: "block"` (the default when durable runs are OFF) decides each gated
 * call IN PROCESS via the `onApprove` callback, without pausing. **Supply
 * `onApprove`, or every gated call is DENIED** — the tool does not run and
 * the model sees an honest refusal. (Through v0.14.0, `mode: "block"`
 * silently executed gated tools with no decision — an inert safety switch;
 * it now fails closed.)
 *
 * @example
 * ```typescript
 * agent.withApprovalPolicy({
 *   tools: ["shell-execute"],
 *   onApprove: async ({ toolName, args }) => ({
 *     approve: await promptHuman(`Run ${toolName}?`, args),
 *   }),
 * })
 * ```
 *
 * @param policy - Approval policy configuration
 * @param policy.tools - Tool names whose calls must be approved
 * @param policy.requireFor - Predicate: return true to require approval for this call
 * @param policy.mode - "detach" (durable pause) or "block" (in-process decision)
 * @param policy.onApprove - In-process decider for block mode: return true/{approve:true} to run, false/{approve:false} to deny
 * @returns `this` for chaining
 */
export const applyWithApprovalPolicy = (state: BuilderState, policy: import('../types.js').ApprovalPolicyConfig) => {
    state._approvalPolicy = policy
}


/**
 * Declare a {@link TaskContract} the agent must satisfy at build time.
 *
 * `build()` validates the contract against the statically-knowable
 * exposed-tool set and the resolved model capability:
 *   - every `required` tool must be exposed to the agent;
 *   - every `forbidden` tool must be absent;
 *   - the resolved capability must meet `modelFloor` (window / thinking /
 *     nativeFC).
 *
 * Violations route through the SAME build-validation errors/warnings path
 * as missing-API-key and capability-source checks: with
 * `.withStrictValidation()` they are hard errors (build throws); otherwise
 * they are warnings. When MCP servers are configured, a missing `required`
 * tool is downgraded to a warning (MCP tools are discovered at connect
 * time and cannot be verified statically).
 *
 * Build-time enforcement only — threading the contract into the kernel at
 * execute-time is a separate slice.
 *
 * @returns `this` for chaining
 */
export const applyWithContract = (state: BuilderState, contract: TaskContract) => {
    state._taskContract = contract
}


/**
 * Set a timeout for agent execution. If the agent doesn't complete within
 * this duration, execution is aborted and an error is thrown.
 * @param ms - Timeout in milliseconds
 * @example .withTimeout(30_000) // 30 seconds
 */
export const applyWithTimeout = (state: BuilderState, ms: number) => {
    state._executionTimeoutMs = ms
}


/**
 * Set the per-LLM-call timeout for local (Ollama) providers. This bounds a
 * single provider request — distinct from {@link withTimeout}, which bounds
 * the *whole agent run* (all iterations combined).
 *
 * Provider-scoped: only Ollama/local honors this (maps to
 * `LLMConfig.ollamaTimeoutMs`, consumed in the local provider's request
 * timeout resolution `request.timeoutMs → ollamaTimeoutMs → default`).
 * Hosted providers (Anthropic/OpenAI/Gemini) ignore it. Equivalent to the
 * `OLLAMA_TIMEOUT_MS` env var, but scoped to this agent.
 *
 * @param ms - Per-call timeout in milliseconds
 * @example .withLlmTimeout(600_000) // tolerate a 10-min cold model load
 */
export const applyWithLlmTimeout = (state: BuilderState, ms: number) => {
    state._ollamaTimeoutMs = ms
}


/**
 * Configure retry policy for LLM calls. When an LLM call fails with a
 * transient error (rate limit, network), it will be retried with exponential backoff.
 * @param policy.maxRetries - Maximum number of retries (default: 0 = no retries)
 * @param policy.backoffMs - Base backoff duration in milliseconds (doubled each retry)
 * @example .withRetryPolicy({ maxRetries: 3, backoffMs: 1000 })
 * The default retry policy also resolves from `CapabilityRegistry`; use
 * this explicit override to pin a per-deployment policy.
 */
export const applyWithRetryPolicy = (state: BuilderState, policy: { maxRetries: number; backoffMs: number }) => {
    state._retryPolicy = policy
}
