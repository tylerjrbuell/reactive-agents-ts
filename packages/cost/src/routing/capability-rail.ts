import { resolveCapability } from "@reactive-agents/llm-provider";
import { getModelCostConfig, TIER_ORDER } from "./complexity-router.js";
import type { ModelTier, Provider } from "../types.js";

/**
 * Cheapest CAPABLE model for a provider: starting at `startTier`, escalate the
 * cost ladder until the tier's model has a context window large enough for the
 * estimated prompt. Pure + total — returns the top-tier model if none qualify.
 *
 * @param tierModels - Optional per-tier model overrides. When provided, the
 *   override is used as the candidate model for that tier but is still subject
 *   to the window check — routing escalates if the override model's window is
 *   too small. Pass `Partial<Record<ModelTier, string>>` from
 *   `ModelRoutingOptions.tierModels`.
 */
export function selectCapableModel(
  provider: Provider,
  startTier: ModelTier,
  estimatedPromptTokens: number,
  tierModels?: Partial<Record<ModelTier, string>>,
): string {
  const start = Math.max(0, TIER_ORDER.indexOf(startTier));
  let lastModel: string = "";
  for (let i = start; i < TIER_ORDER.length; i++) {
    const tier = TIER_ORDER[i]!;
    // F2: honour per-tier override if provided; still window-gate it.
    const model = tierModels?.[tier] ?? getModelCostConfig(tier, provider).model;
    lastModel = model;
    const cap = resolveCapability(provider, model);
    if (cap.recommendedNumCtx >= estimatedPromptTokens) return model;
  }
  return lastModel; // nothing big enough — return the largest-window (top) tier
}
