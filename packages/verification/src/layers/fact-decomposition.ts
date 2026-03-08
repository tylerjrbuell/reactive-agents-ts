import { Effect } from "effect";
import type { LayerResult, Claim } from "../types.js";

// ─── LLM Service Interface (type-only, no import coupling) ───

type LLMServiceLike = {
  complete: (req: any) => Effect.Effect<{ content: string; usage?: { totalTokens?: number } }, any>;
  embed: (texts: readonly string[], model?: string) => Effect.Effect<readonly (readonly number[])[], any>;
};

// ─── Types for LLM-based decomposition ───

interface AtomicClaim {
  claim: string;
  status: "supported" | "unsupported" | "uncertain";
}

/**
 * Fact Decomposition Layer (Tier 1: Heuristic)
 *
 * Splits response into atomic claims and scores each based on specificity.
 * Claims with dates, numbers, and proper nouns are more verifiable (higher confidence).
 */
export const checkFactDecompositionHeuristic = (
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

/**
 * Fact Decomposition Layer (Tier 2: LLM-based)
 *
 * Uses an LLM to extract atomic claims as a JSON list, then scores each
 * claim as supported/unsupported/uncertain.
 * Returns LayerResult with score = supported_count / total_claims.
 * Falls back to heuristic on any error.
 */
export const checkFactDecompositionLLM = (
  response: string,
  llm: LLMServiceLike,
): Effect.Effect<LayerResult, never> => {
  const heuristicFallback = checkFactDecompositionHeuristic(response);

  const llmImpl = Effect.gen(function* () {
    const decompositionPrompt = [
      `You are a fact-checking assistant. Analyze the following response and:`,
      `1. Extract every atomic, independently verifiable claim from the text.`,
      `2. For each claim, assign a status: "supported" (clearly verifiable/factual), "unsupported" (contradicts known facts or unsubstantiated), or "uncertain" (cannot be determined without external sources).`,
      ``,
      `Return ONLY a JSON array of objects with exactly these fields: { "claim": string, "status": "supported" | "unsupported" | "uncertain" }`,
      `Do not include any additional text, markdown, or explanation outside the JSON array.`,
      `If no claims can be identified, return an empty array: []`,
      ``,
      `Response to analyze:`,
      response,
      ``,
      `JSON array of claims:`,
    ].join("\n");

    const completionResult = yield* llm.complete({
      model: "claude-haiku-4-20250514",
      messages: [{ role: "user", content: decompositionPrompt }],
      maxTokens: 2048,
    });

    // Parse the JSON array of claims
    let atomicClaims: AtomicClaim[];
    try {
      const raw = completionResult.content.trim();
      // Strip markdown code fences if present
      const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        return yield* heuristicFallback;
      }
      atomicClaims = parsed
        .filter(
          (item: unknown): item is AtomicClaim =>
            typeof item === "object" &&
            item !== null &&
            "claim" in item &&
            "status" in item &&
            typeof (item as any).claim === "string" &&
            ["supported", "unsupported", "uncertain"].includes((item as any).status),
        )
        .slice(0, 50); // guard against pathological responses
    } catch {
      return yield* heuristicFallback;
    }

    // Handle empty responses
    if (atomicClaims.length === 0) {
      return {
        layerName: "fact-decomposition",
        score: 0.5,
        passed: true,
        details: "LLM-based: No atomic claims identified",
        claims: [],
      } satisfies LayerResult;
    }

    // Score based on supported / total
    const supportedCount = atomicClaims.filter((c) => c.status === "supported").length;
    const unsupportedCount = atomicClaims.filter((c) => c.status === "unsupported").length;
    const uncertainCount = atomicClaims.filter((c) => c.status === "uncertain").length;
    const total = atomicClaims.length;

    // supported = 1.0, uncertain = 0.5, unsupported = 0.0
    const weightedSum =
      supportedCount * 1.0 +
      uncertainCount * 0.5 +
      unsupportedCount * 0.0;
    const score = Math.max(0, Math.min(1, weightedSum / total));

    // Convert to Claim format for compatibility
    const claims: Claim[] = atomicClaims.map((c) => ({
      text: c.claim,
      confidence:
        c.status === "supported" ? 1.0 :
        c.status === "uncertain" ? 0.5 :
        0.0,
    }));

    return {
      layerName: "fact-decomposition",
      score,
      passed: score >= 0.5,
      details: `LLM-based: ${total} claims, supported: ${supportedCount}, uncertain: ${uncertainCount}, unsupported: ${unsupportedCount}, score: ${score.toFixed(2)}`,
      claims,
    } satisfies LayerResult;
  });

  return llmImpl.pipe(Effect.catchAll(() => heuristicFallback));
};

/**
 * Fact Decomposition Layer — primary export (Tier 1: Heuristic).
 * Use checkFactDecompositionLLM for the higher-fidelity LLM-based variant.
 */
export const checkFactDecomposition = checkFactDecompositionHeuristic;
