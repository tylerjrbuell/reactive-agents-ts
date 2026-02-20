import { Effect } from "effect";
import type { LayerResult } from "../types.js";

/**
 * Self-Consistency Layer (Tier 1: Heuristic)
 *
 * Checks for internal contradictions within the response.
 * Looks for negation patterns and conflicting statements.
 */
export const checkSelfConsistency = (
  text: string,
): Effect.Effect<LayerResult, never> =>
  Effect.sync(() => {
    const sentences = text
      .split(/[.!?]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 10);

    if (sentences.length < 2) {
      return {
        layerName: "self-consistency",
        score: 0.8,
        passed: true,
        details: "Too few sentences to check consistency",
      };
    }

    let contradictions = 0;

    // Check for direct negation patterns
    const negationPairs = [
      [/\bis\b/, /\bis not\b/],
      [/\bcan\b/, /\bcannot\b/],
      [/\bwill\b/, /\bwill not\b/],
      [/\btrue\b/, /\bfalse\b/],
      [/\balways\b/, /\bnever\b/],
      [/\beveryone\b/, /\bno one\b/],
    ] as const;

    for (let i = 0; i < sentences.length; i++) {
      for (let j = i + 1; j < sentences.length; j++) {
        for (const [pos, neg] of negationPairs) {
          if (
            (pos.test(sentences[i]!) && neg.test(sentences[j]!)) ||
            (neg.test(sentences[i]!) && pos.test(sentences[j]!))
          ) {
            // Check if about same subject (share >50% words)
            const wordsI = new Set(sentences[i]!.split(/\s+/));
            const wordsJ = new Set(sentences[j]!.split(/\s+/));
            const overlap = [...wordsI].filter((w) => wordsJ.has(w)).length;
            const similarity = overlap / Math.max(wordsI.size, wordsJ.size);
            if (similarity > 0.3) contradictions++;
          }
        }
      }
    }

    const score = Math.max(0, 1 - contradictions * 0.3);

    return {
      layerName: "self-consistency",
      score,
      passed: score >= 0.5,
      details: `${contradictions} potential contradiction(s) found`,
    } satisfies LayerResult;
  });
