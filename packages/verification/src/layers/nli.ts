import { Effect } from "effect";
import type { LayerResult } from "../types.js";

/**
 * Natural Language Inference Layer (Tier 1: Heuristic)
 *
 * Checks if the response logically follows from the input.
 * Uses keyword overlap and relevance heuristics.
 */
export const checkNli = (
  response: string,
  input: string,
): Effect.Effect<LayerResult, never> =>
  Effect.sync(() => {
    const inputWords = new Set(
      input.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    );
    const responseWords = response.toLowerCase().split(/\s+/).filter((w) => w.length > 3);

    if (inputWords.size === 0 || responseWords.length === 0) {
      return {
        layerName: "nli",
        score: 0.5,
        passed: true,
        details: "Insufficient text for NLI check",
      };
    }

    // Relevance: what fraction of response words relate to input
    const relevantCount = responseWords.filter((w) => inputWords.has(w)).length;
    const relevance = relevantCount / responseWords.length;

    // Topicality: does the response stay on topic?
    const topicScore = Math.min(1, relevance * 3); // scale up — even 33% overlap is good

    // Off-topic penalty
    const offTopicPhrases = [
      "as an ai", "i cannot", "i'm unable", "i don't have",
      "i apologize", "sorry, but",
    ];
    const offTopicCount = offTopicPhrases.filter((p) =>
      response.toLowerCase().includes(p),
    ).length;
    const offTopicPenalty = offTopicCount * 0.1;

    const score = Math.max(0, Math.min(1, topicScore - offTopicPenalty + 0.3));

    return {
      layerName: "nli",
      score,
      passed: score >= 0.5,
      details: `Relevance: ${relevance.toFixed(2)}, Topic score: ${topicScore.toFixed(2)}, Off-topic penalty: ${offTopicPenalty.toFixed(2)}`,
    } satisfies LayerResult;
  });
