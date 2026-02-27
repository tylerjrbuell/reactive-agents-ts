import { Effect } from "effect";
import type { LayerResult, Claim } from "../types.js";

// ─── LLM Service Interface (type-only, no import coupling) ───

type LLMServiceLike = {
  complete: (req: any) => Effect.Effect<{ content: string; usage?: { totalTokens?: number } }, any>;
};

// ─── Tavily Search Helper ───

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

const searchTavily = async (
  query: string,
  apiKey: string,
  maxResults = 3,
): Promise<TavilyResult[]> => {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      api_key: apiKey,
    }),
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as { results: TavilyResult[] };
  return data.results ?? [];
};

// ─── Claim Scoring ───

/**
 * Score how well search results support a given claim using keyword overlap.
 * Returns a score between 0 (no support) and 1 (strong support).
 */
const scoreClaimAgainstResults = (
  claim: string,
  results: TavilyResult[],
): { score: number; status: "supported" | "contradicted" | "unknown" } => {
  if (results.length === 0) {
    return { score: 0.5, status: "unknown" };
  }

  // Extract meaningful words from the claim (3+ chars, lowercased)
  const claimWords = new Set(
    claim
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 3),
  );

  if (claimWords.size === 0) {
    return { score: 0.5, status: "unknown" };
  }

  // Check each result for keyword overlap
  let bestOverlap = 0;
  for (const result of results) {
    const resultText = `${result.title} ${result.content}`.toLowerCase();
    const resultWords = new Set(resultText.split(/\W+/).filter((w) => w.length >= 3));

    let matchCount = 0;
    for (const word of claimWords) {
      if (resultWords.has(word)) matchCount++;
    }

    const overlap = matchCount / claimWords.size;
    if (overlap > bestOverlap) bestOverlap = overlap;
  }

  // Interpret the overlap score
  if (bestOverlap >= 0.6) {
    return { score: 0.8 + bestOverlap * 0.2, status: "supported" };
  } else if (bestOverlap >= 0.3) {
    return { score: 0.5 + bestOverlap * 0.3, status: "unknown" };
  } else {
    return { score: 0.3, status: "unknown" };
  }
};

/**
 * Multi-Source Layer (Tier 1: Heuristic Placeholder)
 *
 * Multi-source cross-referencing requires external search APIs.
 * Without an LLM and Tavily API key, returns neutral confidence.
 * Use `checkMultiSourceLLM` for the real implementation.
 */
export const checkMultiSource = (
  _text: string,
): Effect.Effect<LayerResult, never> =>
  Effect.succeed({
    layerName: "multi-source",
    score: 0.5,
    passed: true,
    details: "Multi-source cross-referencing not yet implemented. Score reflects neutral confidence.",
  });

/**
 * Multi-Source Layer (Tier 2: LLM + Tavily Search)
 *
 * 1. Extracts factual claims from the response via LLM
 * 2. Searches each claim against Tavily for corroboration
 * 3. Scores claims based on keyword overlap with search results
 * 4. Returns aggregate confidence score
 *
 * Falls back to heuristic placeholder when TAVILY_API_KEY is missing.
 */
export const checkMultiSourceLLM = (
  response: string,
  llm: LLMServiceLike,
): Effect.Effect<LayerResult, never> => {
  const heuristicFallback = checkMultiSource(response);

  const llmImpl = Effect.gen(function* () {
    // Require Tavily API key for external search
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return yield* Effect.succeed({
        layerName: "multi-source",
        score: 0.5,
        passed: true,
        details: "Multi-source skipped: TAVILY_API_KEY not set.",
      } satisfies LayerResult);
    }

    // Step 1: Extract factual claims via LLM
    const extractionPrompt = [
      `Extract the key factual claims from this text that can be verified via web search.`,
      `Focus on: specific facts, statistics, dates, named entities, and verifiable statements.`,
      `Skip opinions, hedged statements, and subjective assessments.`,
      `Return ONLY a JSON array of strings, each being one verifiable claim.`,
      `Return at most 5 claims. If no verifiable claims exist, return [].`,
      ``,
      `Text:`,
      response,
      ``,
      `JSON array of claims:`,
    ].join("\n");

    const completionResult = yield* llm.complete({
      messages: [{ role: "user", content: extractionPrompt }],
      maxTokens: 1024,
    });

    // Parse claims
    let extractedClaims: string[];
    try {
      const raw = completionResult.content.trim();
      const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        return yield* heuristicFallback;
      }
      extractedClaims = parsed
        .filter((item: unknown): item is string => typeof item === "string" && item.length > 10)
        .slice(0, 5);
    } catch {
      return yield* heuristicFallback;
    }

    if (extractedClaims.length === 0) {
      return {
        layerName: "multi-source",
        score: 0.5,
        passed: true,
        details: "No verifiable claims found for multi-source checking.",
        claims: [],
      } satisfies LayerResult;
    }

    // Step 2: Search each claim via Tavily (with concurrency limit)
    const claimResults: { claim: string; score: number; status: string }[] = [];

    for (const claim of extractedClaims) {
      const searchResults = yield* Effect.tryPromise({
        try: () => searchTavily(claim, apiKey, 3),
        catch: () => [] as TavilyResult[],
      });

      const { score, status } = scoreClaimAgainstResults(claim, searchResults);
      claimResults.push({ claim, score, status });
    }

    // Step 3: Aggregate scores
    const avgScore =
      claimResults.reduce((sum, c) => sum + c.score, 0) / claimResults.length;

    const supportedCount = claimResults.filter((c) => c.status === "supported").length;
    const unknownCount = claimResults.filter((c) => c.status === "unknown").length;
    const contradictedCount = claimResults.filter((c) => c.status === "contradicted").length;

    const claims: Claim[] = claimResults.map((c) => ({
      text: c.claim,
      confidence: c.score,
      source: "tavily-search",
    }));

    return {
      layerName: "multi-source",
      score: Math.max(0, Math.min(1, avgScore)),
      passed: avgScore >= 0.5,
      details: `Multi-source: ${claimResults.length} claims checked, supported: ${supportedCount}, unknown: ${unknownCount}, contradicted: ${contradictedCount}, score: ${avgScore.toFixed(2)}`,
      claims,
    } satisfies LayerResult;
  });

  return llmImpl.pipe(Effect.catchAll(() => heuristicFallback));
};
