/**
 * ProviderCapabilities — static, per-provider API-surface declaration.
 *
 * Coarse-grained boolean flags describing what each provider's API reliably
 * supports. Used by the framework to pick between native function calling
 * and structured-output fallback paths without querying the provider at
 * runtime.
 *
 * ## Taxonomy (orthogonal types — do not collapse)
 *
 * - **`ProviderCapabilities`** (this type) — per-provider API surface flags
 *   (tool calling, streaming, structured output, logprobs).
 * - **{@link StructuredOutputCapabilities}** (in `./types.ts`) — granular
 *   JSON-extraction strategy flags (native JSON mode, schema enforcement,
 *   prefill, grammar constraints).
 * - **{@link Capability}** (in `./capability.ts`) — per-(provider, model)
 *   spec resolved via probe → static-table → fallback (context window,
 *   tokenizer, tier, dialect).
 *
 * These three types answer different questions; an earlier "Capability
 * supersedes ProviderCapabilities" design intent was reverted because the
 * concerns are orthogonal in practice (see wiki HS-18). Treat as permanent.
 */
export interface ProviderCapabilities {
  /** Provider supports native function / tool calling (structured tool_use). */
  readonly supportsToolCalling: boolean;
  /** Provider supports streaming completions. */
  readonly supportsStreaming: boolean;
  /** Provider supports structured / JSON output modes natively. */
  readonly supportsStructuredOutput: boolean;
  /** Provider can return per-token log probabilities. */
  readonly supportsLogprobs: boolean;
}

/** Safe defaults — assumes minimal capabilities for unknown providers. */
export const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supportsToolCalling: false,
  supportsStreaming: true,
  supportsStructuredOutput: false,
  supportsLogprobs: false,
};
