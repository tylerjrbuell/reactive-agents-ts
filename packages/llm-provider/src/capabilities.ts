/**
 * ProviderCapabilities — static capability declaration for each LLM provider.
 *
 * These are coarse-grained, model-agnostic flags that reflect what the
 * provider's API reliably supports. They let the framework choose between
 * native function calling and structured-output fallback paths without
 * querying the provider at runtime.
 *
 * @deprecated Phase 1 introduces the per-(provider, model) {@link Capability}
 * struct in `./capability.ts` with 12 fields and probe + static-table +
 * fallback resolution. `ProviderCapabilities` will be removed in Phase 2 once
 * all internal callers migrate to `Capability`. New code should consume
 * `Capability` directly via the resolver (S1.3).
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
