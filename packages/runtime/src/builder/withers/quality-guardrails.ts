/**
 * Guardrail / verification / judgment / honesty-rails withers for ReactiveAgentBuilder
 * (2026-10-20 builder decomp, GH #218 / HS-248).
 *
 * Class methods on the builder are thin delegates that mutate state via these
 * helpers and return `this` for chaining; public-contract JSDoc moved verbatim.
 */
import type { GuardrailsOptions, VerificationOptions, JudgmentBuilderOptions } from '../types.js'
import type { BuilderState } from './_state.js'

/**
 * Enable guardrails to protect against injection attacks and PII exposure.
 *
 * Optionally provide configuration to toggle individual detectors.
 *
 * @param options - Optional guardrail configuration
 * @param options.injection - Enable prompt injection detection. Default: true
 * @param options.pii - Enable PII detection and masking. Default: true
 * @param options.toxicity - Enable toxicity detection. Default: true
 * @param options.customBlocklist - Custom blocklist of words/phrases (case-insensitive substring match)
 * @param options.enableJudgmentBattery - Opt-in judgment battery. Default: false
 * @param options.judgmentStrictness - "additive" | "jev-primary". Default: "additive"
 * @param options.judgmentActionThreshold - Noul probability to block. Default: 0.7
 * @param options.judgmentReviewThreshold - Noul probability to review without blocking. Default: 0.4
 * @param options.screenOutputs - Opt-in output-side judgment screening. Default: false
 * @returns `this` for chaining
 * @see {@link GuardrailsOptions} — the full named type with all field docs.
 */
export const applyWithGuardrails = (state: BuilderState, options?: GuardrailsOptions) => {
    state._enableGuardrails = true
    if (options) state._guardrailsOptions = options
}


/**
 * Enable semantic verification to assess confidence in agent outputs.
 *
 * Optionally provide configuration to toggle strategies and set thresholds.
 *
 * @param options - Optional verification configuration
 * @param options.semanticEntropy - Enable semantic entropy estimation. Default: true
 * @param options.factDecomposition - Enable fact decomposition. Default: true
 * @param options.multiSource - Enable multi-source verification. Default: false
 * @param options.selfConsistency - Enable self-consistency checks. Default: true
 * @param options.nli - Enable natural language inference. Default: true
 * @param options.hallucinationDetection - Enable hallucination detection. Default: false
 * @param options.hallucinationThreshold - Hallucination score threshold (0-1). Default: 0.10
 * @param options.passThreshold - Overall pass threshold (0-1). Default: 0.7
 * @param options.riskThreshold - Risk threshold below which outputs are flagged (0-1). Default: 0.5
 * @param options.useLLMTier - Use runtime LLMService for LLM-backed verification. Default: true
 * @param options.onReject - "block" | "annotate" | "proceed" on rejection. Default: "proceed"
 * @param options.strictValidation - Promote missing-key/unknown-model checks to hard build errors
 * @param options.lazyValidation - Keep checks as warnings even under strict validation
 * @returns `this` for chaining
 * @see {@link VerificationOptions} — the full named type with all field docs.
 * @see {@link HarnessProfile.balanced} — composable preset with the
 *   verifier default-on; `HarnessProfile.lean()` opts out.
 */
export const applyWithVerification = (state: BuilderState, options?: VerificationOptions) => {
    state._enableVerification = true
    if (options) {
        const { strictValidation, lazyValidation, ...verification } = options
        state._verificationOptions = verification
        // Validation-timing folds (audit #10): same slots the standalone
        // withers set. Only when explicitly provided.
        if (strictValidation !== undefined) state._strictValidation = strictValidation
        if (lazyValidation !== undefined) state._lazyValidation = lazyValidation
    }
}


/**
 * Enable the optional `JudgmentService` (calibrated Choice/Score/Noul
 * typed judgments via `@reactive-agents/judgment`). Off by default —
 * without this call, `JudgmentService` is genuinely absent from the
 * runtime's Layer graph and every existing harness site takes its
 * existing regex/heuristic/LLM-classifier path unchanged.
 *
 * With it, two things become available:
 * - `agent.judge({ state, questions })` — the public composable
 *   primitive for calibrated Choice/Score/Noul questions.
 * - Per-site opt-ins via `options.sites` (all default off) for later
 *   internal harness consumers (strategy-selection, task-comprehension,
 *   guardrail-battery, tool-name-healing) — see
 *   `wiki/Planning/Implementation-Plans/2026-09-20-typesafe-judgment-layer.md`.
 *   Nothing reads `sites` yet; setting them today has no effect until
 *   the corresponding site is wired.
 *
 * Backend selection: `"jev"` (calls the TypeSafe API) when `options.apiKey`
 * or the `TYPESAFE_API_KEY` env var resolves, else `"llm"` (emulates the
 * primitive over this agent's own configured `LLMService` — uncalibrated,
 * `calibrated: false` on every answer). Override with `options.backend`.
 *
 * @param options - Optional judgment configuration
 * @param options.apiKey - TypeSafe API key. Falls back to TYPESAFE_API_KEY env var
 * @param options.baseUrl - Backend base URL override (TypeSafe root or Ollama server root)
 * @param options.model - Model identifier passed to the backend on each ask() call
 * @param options.timeoutMs - Per-request timeout in ms. Default: 3000
 * @param options.defaultConfidenceFloor - Floor applied when consumer doesn't specify minConfidence/minProbability
 * @param options.backend - Force a backend: "jev" | "llm" | "ollama"
 * @param options.ollama - Ollama-specific options: { keepAlive }
 * @param options.sites - Per-site opt-ins for internal harness consumers (all default off)
 * @returns `this` for chaining
 */
export const applyWithJudgment = (state: BuilderState, options?: JudgmentBuilderOptions) => {
    state._enableJudgment = true
    if (options) state._judgmentOptions = options
}


/**
 * Enable opt-in numeric evidence-grounding. Off by default.
 *
 * When on, figures in the final answer are checked against the FULL tool
 * data (resolved via storedKey to bypass compression) with rounding
 * tolerance. `mode: "warn"` = advisory; `mode: "block"` = one corrective
 * retry then degrade to warn (never hard-fails the run).
 *
 * @param options - Grounding configuration
 * @param options.mode - "warn" (advisory) | "block" (one corrective retry then degrade to warn)
 * @param options.tolerance - Numeric match tolerance as a fraction (rounding). Default: 0.01
 * @param options.maxRetries - Block mode corrective retries before degrading to warn. Default: 1
 * @param options.fabricationGuard - Honesty-rails fold: "off" | "warn" | "block"
 * @param options.stallPolicy - Honesty-rails fold: { ignoredNudgeTolerance, escalateNudgeContent }
 * @returns `this` for chaining
 */
export const applyWithGrounding = (state: BuilderState, options: import('../types.js').GroundingOptions) => {
    const { fabricationGuard, stallPolicy, ...grounding } = options
    state._groundingConfig = grounding
    // Honesty-rails umbrella folds (audit #18, Q3): route to the SAME slots
    // the standalone withers set. Only when explicitly provided — grounding's
    // opt-in defaults and the guard's always-on default are untouched.
    if (fabricationGuard !== undefined) state._fabricationGuard = fabricationGuard
    if (stallPolicy !== undefined) state._stallPolicy = stallPolicy
}


/**
 * Opt in to an Ed25519 provenance signature on the trust receipt
 * (Arc 1 Task 9). Off by default — the receipt is unsigned unless a key
 * is configured here or via the `RA_RECEIPT_KEY` env var (this option
 * wins when both are present).
 *
 * HONEST-CLAIMS SCOPE: the signature certifies "this receipt, this run,
 * untampered" — it NEVER certifies the correctness of the agent's
 * answer. See `TrustReceipt.signature`'s JSDoc in `@reactive-agents/core`.
 *
 * @example
 * ```typescript
 * const { privateKeyJwk } = await generateReceiptKeyPair();
 * agent.withReceiptSigning({ privateKeyJwk });
 * ```
 * @returns `this` for chaining
 */
export const applyWithReceiptSigning = (state: BuilderState, options: import('../types.js').ReceiptSigningOptions) => {
    state._receiptSigningKey = options.privateKeyJwk
}


/**
 * Configure the fabrication guard — the always-on verifier check that
 * rejects invented empirical performance measurements (benchmark timings,
 * % speed-ups) absent from the tool-observation corpus.
 *
 * On by default (`"block"`) — no call needed for protection. Use this only
 * to soften (`"warn"`, advisory) or disable (`"off"`). High-precision: only
 * perf measurements are policed; counts, prices, Big-O are ignored, and a
 * claim grounded by a real benchmark/execution tool always passes.
 *
 * Also settable via the `RA_FABRICATION_GUARD` env var (this method wins).
 *
 * TWO ENFORCEMENT SITES, different defaults — do not conflate them:
 *  - the IN-LOOP verifier check described above is on by default (`"block"`,
 *    env-settable);
 *  - the TERMINAL grounding check (the strategy result mint) is OPT-IN ONLY.
 *    It flips a run whose declared required tools never succeeded to
 *    `status:"failed"` with an honest abstention, and it fires only when this
 *    method was actually called with `"block"`. An unconfigured run is never
 *    judged there and stays byte-identical — the env var does not arm it.
 *
 * @param mode - `"block"` (default) | `"warn"` | `"off"`
 * @returns `this` for chaining
 */
export const applyWithFabricationGuard = (state: BuilderState, mode: import('@reactive-agents/reasoning').FabricationGuardMode = 'block') => {
    state._fabricationGuard = mode
}


/**
 * Tune the stall / no-progress policy — how the harness reacts when the
 * model ignores required-tool nudges (makes no progress toward a required
 * tool across consecutive nudges).
 *
 * Sensible defaults apply when unset: tolerate **2** consecutive ignored
 * nudges before fast-escalating (deliver accumulated artifacts, else fail)
 * instead of looping to the full nudge cap, and **escalate** the nudge
 * wording on repeats rather than repeating verbatim. This bounds wasted
 * iterations/tokens on stuck runs while keeping legitimately-progressing
 * runs untouched (progress resets the ignored streak).
 *
 * @example
 * ```typescript
 * agent.withStallPolicy({ ignoredNudgeTolerance: 1 })   // escalate fast
 * agent.withStallPolicy({ escalateNudgeContent: false }) // stable wording
 * ```
 * @returns `this` for chaining
 */
export const applyWithStallPolicy = (state: BuilderState, policy: import('@reactive-agents/reasoning').StallPolicy) => {
    state._stallPolicy = policy
}


/**
 * Enable the kill switch service — allows pausing, resuming, stopping, and terminating agents.
 *
 * Provides fine-grained control over agent execution at phase boundaries.
 * Required for `.pause()`, `.resume()`, `.stop()`, and `.terminate()` methods on ReactiveAgent.
 *
 * @returns `this` for chaining
 * Composable equivalent: the 5 shipped killswitches (master plan §11.4 —
 *   `budgetLimit`, `maxIterations`, `timeoutAfter`, `watchdog`,
 *   `requireApprovalFor`) via `.compose(killSwitch(...))`.
 *   Note: `confidenceFloor` was unshipped 2026-05-19 (Tier 0 honesty sweep,
 *   GH #160) — verify-phase killswitches cannot fire at runtime per the
 *   compose pipeline contract; see `packages/compose/test/killswitches.test.ts`.
 */
export const applyWithKillSwitch = (state: BuilderState, ) => {
    state._enableKillSwitch = true
}


/**
 * Enable behavioral contracts — enforce constraints on tool usage, outputs, and iterations.
 *
 * Contracts can enforce that certain tools must/must not be used, iterations cannot exceed
 * a threshold, or output must conform to specific patterns. Violations trigger guardrail violations.
 *
 * @param contract - Behavioral contract specification
 * @returns `this` for chaining
 * Composable equivalent: `.withGuardrails(...)` +
 *   `.compose(h => h.before('act', ...))` — behavioural contracts also
 *   compose from guardrails plus the pre-act chokepoint.
 */
export const applyWithBehavioralContracts = (state: BuilderState,     contract: import('@reactive-agents/guardrails').BehavioralContract) => {
    state._enableBehavioralContracts = true
    state._behavioralContract = contract
}
