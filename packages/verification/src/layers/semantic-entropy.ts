import { Effect } from "effect";
import type { LayerResult } from "../types.js";

// ─── LLM Service Interface (type-only, no import coupling) ───

type LLMServiceLike = {
  complete: (req: any) => Effect.Effect<{ content: string; usage?: { totalTokens?: number } }, any>;
  embed: (texts: readonly string[], model?: string) => Effect.Effect<readonly number[][], any>;
};

// ─── Cosine Similarity Helper ───

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Average pairwise cosine similarity ───

function avgPairwiseSimilarity(embeddings: readonly (readonly number[])[]): number {
  if (embeddings.length < 2) return 1;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      total += cosineSimilarity(embeddings[i]!, embeddings[j]!);
      pairs++;
    }
  }
  return pairs === 0 ? 1 : total / pairs;
}

/**
 * Semantic Entropy Layer (Tier 1: Heuristic)
 *
 * Measures uncertainty by analyzing word diversity and specificity.
 * Higher entropy = more vague = lower confidence.
 */
export const checkSemanticEntropyHeuristic = (
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

/**
 * Semantic Entropy Layer (Tier 2: LLM-based)
 *
 * Generates N=3 paraphrases of the response via a cheap LLM prompt,
 * then computes embedding similarity between paraphrases.
 * High divergence = high entropy = low confidence score.
 * Falls back to heuristic on any error.
 */
export const checkSemanticEntropyLLM = (
  response: string,
  input: string,
  llm: LLMServiceLike,
): Effect.Effect<LayerResult, never> => {
  const heuristicFallback = checkSemanticEntropyHeuristic(response, input);

  const llmImpl = Effect.gen(function* () {
    const N = 3;

    // Generate N paraphrases using a cheap prompt
    const paraphrasePrompt = [
      `You are a paraphrasing assistant. Given the following response to a question, produce exactly ${N} distinct paraphrases of it.`,
      `Return ONLY a JSON array of ${N} strings (the paraphrases) with no additional text, markdown, or explanation.`,
      ``,
      `Original question: ${input}`,
      ``,
      `Response to paraphrase: ${response}`,
      ``,
      `JSON array of ${N} paraphrases:`,
    ].join("\n");

    const completionResult = yield* llm.complete({
      model: "claude-haiku-4-20250514",
      messages: [{ role: "user", content: paraphrasePrompt }],
      maxTokens: 1024,
    });

    // Parse the JSON array
    let paraphrases: string[];
    try {
      const raw = completionResult.content.trim();
      // Strip markdown code fences if present
      const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed) || parsed.length < 2) {
        return yield* heuristicFallback;
      }
      paraphrases = parsed.slice(0, N).map(String);
    } catch {
      return yield* heuristicFallback;
    }

    // Include the original response to measure self-consistency
    const textsToEmbed: readonly string[] = [response, ...paraphrases];

    // Compute embeddings for all texts
    const embeddings = yield* llm.embed(textsToEmbed);

    if (embeddings.length < 2) {
      return yield* heuristicFallback;
    }

    // Average pairwise cosine similarity — high similarity means low entropy (high confidence)
    const avgSim = avgPairwiseSimilarity(embeddings);

    // avgSim is in [0, 1]. High similarity → low semantic entropy → high confidence.
    // We map directly: score = avgSim
    const score = Math.max(0, Math.min(1, avgSim));

    return {
      layerName: "semantic-entropy",
      score,
      passed: score >= 0.5,
      details: `LLM-based: avg paraphrase similarity ${avgSim.toFixed(3)}, paraphrases: ${paraphrases.length}, Score: ${score.toFixed(2)}`,
    } satisfies LayerResult;
  });

  return llmImpl.pipe(Effect.catchAll(() => heuristicFallback));
};

/**
 * Semantic Entropy Layer — primary export (Tier 1: Heuristic).
 * Use checkSemanticEntropyLLM for the higher-fidelity LLM-based variant.
 */
export const checkSemanticEntropy = checkSemanticEntropyHeuristic;
