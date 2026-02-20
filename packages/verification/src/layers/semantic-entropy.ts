import { Effect } from "effect";
import type { LayerResult } from "../types.js";

/**
 * Semantic Entropy Layer (Tier 1: Heuristic)
 *
 * Measures uncertainty by analyzing word diversity and specificity.
 * Higher entropy = more vague = lower confidence.
 */
export const checkSemanticEntropy = (
  text: string,
  _context?: string,
): Effect.Effect<LayerResult, never> =>
  Effect.sync(() => {
    const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const unique = new Set(words);
    const diversity = words.length > 0 ? unique.size / words.length : 0;

    // Hedging phrases indicate uncertainty
    const hedges = [
      "might", "could", "perhaps", "possibly", "maybe",
      "i think", "i believe", "it seems", "probably", "likely",
      "not sure", "uncertain", "approximately", "roughly",
    ];
    const hedgeCount = hedges.filter((h) => text.toLowerCase().includes(h)).length;
    const hedgePenalty = Math.min(0.3, hedgeCount * 0.1);

    // Very short responses are suspicious
    const lengthBonus = Math.min(0.1, words.length / 100);

    const score = Math.max(0, Math.min(1, diversity + lengthBonus - hedgePenalty));

    return {
      layerName: "semantic-entropy",
      score,
      passed: score >= 0.5,
      details: `Diversity: ${diversity.toFixed(2)}, Hedges: ${hedgeCount}, Score: ${score.toFixed(2)}`,
    } satisfies LayerResult;
  });
