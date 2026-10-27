/**
 * What an LLM call is FOR — the single canonical declaration.
 *
 * Lives in `core` because three layers need it and the dependency graph only
 * allows one home: `llm-provider` stamps it on the wire request, `core`'s
 * EventBus carries it on `LLMExchangeEmitted`, and `trace` records it on the
 * `llm-exchange` event. `core` has zero workspace dependencies, so it is the
 * only package all three can import from.
 *
 * Declared ONCE deliberately. A second hand-maintained copy at any of those
 * boundaries is the drift class this repo's debt register tracks — the same
 * shape that let `approvalPolicy` ship with `mode: "block"` gating nothing, and
 * that made `LlmPurpose` a duplicate of this union until it became an alias.
 * `llm-provider` re-exports this as `LlmCallPurpose`; the kernel gateway aliases
 * it as `LlmPurpose`. There is one union.
 *
 * The distinction that matters: `"think"` is an agent-visible turn; everything
 * else is a harness-internal call the agent never sees. The deterministic test
 * provider splits its turn cursor on exactly that boundary so harness calls
 * cannot consume the agent's scripted turns.
 *
 * Recording it on the trace is what makes token spend attributable to a
 * SUBSYSTEM rather than to "the harness" — without it a run reports a total and
 * no composition.
 */
export type LlmCallPurpose =
  | "think"
  | "plan"
  | "synthesize"
  | "extract"
  | "classify"
  | "verify";

/**
 * Provider reasoning ("thinking") for one LLM exchange, published so a UI can
 * show it. Sits beside {@link LlmCallPurpose} because it is LLM-exchange
 * metadata (not a lifecycle event) and `event-bus.ts` is at its size ceiling.
 * Distinct from `LLMExchangeEmitted.thinkingPreview` (capped forensics): this
 * is the readable text, capped by the emitter's UI budget; `truncated` = cut.
 * Only models whose provider returns a thinking channel produce it.
 */
export type ThinkingEmitted = {
  readonly _tag: "ThinkingEmitted";
  readonly taskId: string;
  readonly iteration: number;
  readonly content: string;
  readonly truncated?: boolean;
  readonly timestamp?: number;
};
