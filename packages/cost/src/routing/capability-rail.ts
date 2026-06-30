import { resolveCapability } from "@reactive-agents/llm-provider";
import type { Provider } from "@reactive-agents/core";
import { getModelCostConfig, TIER_ORDER } from "./complexity-router.js";
import type { ModelTier } from "../types.js";

/**
 * Cheapest CAPABLE model for a provider: starting at `startTier`, escalate the
 * cost ladder until the tier's model has a context window large enough for the
 * estimated prompt. Pure + total — returns the top-tier model if none qualify.
 */
export function selectCapableModel(
  provider: Provider,
  startTier: ModelTier,
  estimatedPromptTokens: number,
): string {
  const start = Math.max(0, TIER_ORDER.indexOf(startTier));
  let lastModel = getModelCostConfig(TIER_ORDER[start]!, provider).model;
  for (let i = start; i < TIER_ORDER.length; i++) {
    const model = getModelCostConfig(TIER_ORDER[i]!, provider).model;
    lastModel = model;
    const cap = resolveCapability(provider, model);
    if (cap.recommendedNumCtx >= estimatedPromptTokens) return model;
  }
  return lastModel; // nothing big enough — return the largest-window (top) tier
}
