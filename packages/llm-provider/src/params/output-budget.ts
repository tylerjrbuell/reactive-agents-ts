// packages/llm-provider/src/params/output-budget.ts
//
// F1 (architecture sweep 2026-07-07, 03-provider-model-params) — make
// `Capability.maxOutputTokens` a live signal in the request path. Providers
// previously computed their output budget as `request.maxTokens ??
// config.defaultMaxTokens` and never clamped against the model's real output
// ceiling, so a model with an 8k output cap and a caller asking for 64k
// silently over-requested.

/**
 * Clamp a requested output-token budget against the model's capability
 * ceiling: `min(requested, capability.maxOutputTokens)` when both are
 * defined, else `requested` unchanged.
 *
 * Constraint enforced: the wire-level output budget never exceeds what the
 * model can actually produce in one call — but ONLY when the ceiling is
 * authoritative. Two deliberate no-op paths:
 *
 *   • `capability.maxOutputTokens === undefined` — no ceiling known, nothing
 *     to clamp against.
 *   • `capability.source === "fallback"` — a fallback capability carries a
 *     conservative GUESS (2048 generic / 8192 openai-compat, see
 *     `fallbackCapability` in capability.ts), not a real model limit.
 *     Clamping against a guess would silently cut the default 4096 budget
 *     for ANY model missing from the static table (e.g. a newly released
 *     frontier model), so fallback-sourced ceilings never clamp.
 */
export function clampOutputBudget(
  requested: number | undefined,
  capability: { readonly maxOutputTokens?: number; readonly source?: string },
): number | undefined {
  if (requested === undefined) return undefined;
  if (capability.maxOutputTokens === undefined) return requested;
  if (capability.source === "fallback") return requested;
  return Math.min(requested, capability.maxOutputTokens);
}
