/**
 * Context-window fallback for the ContextPressure gauge.
 *
 * Only Ollama's provider surfaces the exact resolved window
 * (`resolvedParams.contextWindow`). For hosted providers the framework's own
 * capability table is the honest source: used only when a real row resolves
 * (`source !== "fallback"`), never a made-up window.
 */
import { resolveCapability } from "@reactive-agents/llm-provider";

/**
 * Resolve the context window for a call.
 *
 * Provider-set window wins. Otherwise a non-Ollama provider with a real
 * capability row supplies `maxContextTokens`. Ollama is excluded: its real
 * `num_ctx` may differ from the table, so a missing reading stays missing.
 *
 * @returns window in tokens, or 0 when unknown.
 */
export function resolveContextWindow(
  providerSet: number | undefined,
  provider: string | undefined,
  model: string | undefined,
): number {
  if (typeof providerSet === "number" && providerSet > 0) return providerSet;
  if (!provider || !model || provider === "ollama" || provider === "unknown") return 0;
  try {
    const cap = resolveCapability(provider, model);
    return cap.source !== "fallback" && cap.maxContextTokens > 0 ? cap.maxContextTokens : 0;
  } catch {
    return 0;
  }
}
