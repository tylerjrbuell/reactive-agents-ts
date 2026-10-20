/**
 * Validation-mode + test-scaffolding withers for ReactiveAgentBuilder
 * (2026-10-20 builder decomp, GH #218 / HS-248).
 *
 * Class methods on the builder are thin delegates that mutate state via these
 * helpers and return `this` for chaining; public-contract JSDoc moved verbatim.
 */
import type { TestTurn } from '@reactive-agents/llm-provider'
import type { BuilderState } from './_state.js'

/**
 * Configure a deterministic multi-turn scenario for the test LLM provider.
 *
 * Turns are consumed sequentially. Each turn produces one LLM response:
 * - `{ text: "..." }` — plain text, stopReason: "end_turn"
 * - `{ toolCall: { name, args } }` — single tool call, stopReason: "tool_use"
 * - `{ toolCalls: [...] }` — parallel tool calls, stopReason: "tool_use"
 * - `{ json: value }` — structured output for completeStructured(), stopReason: "end_turn"
 * - `{ error: "message" }` — throws with that message
 *
 * Add `match?: string` to any turn to guard it with a regex — the turn is only
 * consumed when the LLM input matches the pattern. End scenarios with an
 * unconditional turn as catch-all. The last turn repeats when exhausted.
 *
 * Automatically sets the provider to "test".
 *
 * @param turns - Array of test turns to consume sequentially
 * @returns `this` for chaining
 */
export const applyWithTestScenario = (state: BuilderState, turns: TestTurn[]) => {
    state._testScenario = turns
    state._provider = 'test'
    state._providerExplicit = true
}


/**
 * Enable strict build-time validation. Missing API keys and model/provider
 * mismatches become hard errors instead of warnings.
 *
 * Equivalent env config: `REACTIVE_AGENTS_STRICT_VALIDATION=1`.
 *   `HarnessProfile.balanced()` also enables strict build defaults.
 */
export const applyWithStrictValidation = (state: BuilderState, ) => {
    state._strictValidation = true
}


/**
 * Force the missing-API-key and unknown-for-provider-model checks to stay
 * warnings even under {@link withStrictValidation} (lazy mode).
 *
 * By default `build()` already warns (not throws) on a missing key or an
 * unknown-for-provider model and succeeds — the clean typed failure then
 * surfaces at run() time. {@link withStrictValidation} promotes those two
 * gates to hard build errors; call this to keep them as warnings even when
 * strict is on (useful when keys are injected after construction, or in
 * tooling that constructs many configs eagerly). Keyless providers
 * (`ollama`, `test`) are exempt from the key gate regardless.
 *
 * Equivalent env config: `REACTIVE_AGENTS_LAZY_VALIDATION=1`.
 */
export const applyWithLazyValidation = (state: BuilderState, ) => {
    state._lazyValidation = true
}
