import { Effect } from "effect";
import type { LayerResult, Claim } from "../types.js";

/**
 * Fact Decomposition Layer (Tier 1: Heuristic)
 *
 * Splits response into atomic claims and scores each based on specificity.
 * Claims with dates, numbers, and proper nouns are more verifiable (higher confidence).
 */
export const checkFactDecomposition = (
  text: string,
): Effect.Effect<LayerResult, never> =>
  Effect.sync(() => {
    // Split into sentences
    const sentences = text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);

    if (sentences.length === 0) {
      return {
        layerName: "fact-decomposition",
        score: 0.5,
        passed: true,
        details: "No verifiable claims found",
        claims: [],
      };
    }

    const claims: Claim[] = sentences.map((sentence) => {
      let confidence = 0.5; // baseline

      // Numbers increase specificity
      if (/\d+/.test(sentence)) confidence += 0.15;

      // Proper nouns (capitalized words) increase specificity
      const properNouns = sentence.match(/\b[A-Z][a-z]+\b/g) ?? [];
      confidence += Math.min(0.15, properNouns.length * 0.05);

      // Dates increase specificity
      if (/\d{4}|\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(sentence)) {
        confidence += 0.1;
      }

      // Weasel words decrease confidence
      if (/\b(some|many|often|generally|usually)\b/i.test(sentence)) {
        confidence -= 0.1;
      }

      return {
        text: sentence,
        confidence: Math.max(0, Math.min(1, confidence)),
      };
    });

    const avgConfidence = claims.reduce((sum, c) => sum + c.confidence, 0) / claims.length;

    return {
      layerName: "fact-decomposition",
      score: avgConfidence,
      passed: avgConfidence >= 0.5,
      details: `${claims.length} claims, avg confidence: ${avgConfidence.toFixed(2)}`,
      claims,
    } satisfies LayerResult;
  });
