import { Effect } from "effect";
import type { LayerResult } from "../types.js";
import type { HallucinationClaim } from "../types.js";

// ─── LLM Service Interface (type-only, no import coupling) ───

type LLMServiceLike = {
  complete: (req: any) => Effect.Effect<{ content: string; usage?: { totalTokens?: number } }, any>;
};

// ─── Claim Extraction ───

const uncertainMarkers = [
  "might", "maybe", "perhaps", "possibly", "could be",
  "approximately", "around", "roughly",
];

const certainMarkers = [
  "definitely", "certainly", "always", "never", "exactly",
  "is", "was",
];

const opinionPrefixes = ["i think", "i believe"];
const imperativePrefixes = ["please", "let's", "try"];

/**
 * Extract factual claims from text using heuristic sentence analysis.
 *
 * Splits text into sentences, filters out non-factual content,
 * and classifies confidence level of each remaining claim.
 */
export const extractClaims = (text: string): HallucinationClaim[] => {
  if (!text || text.trim().length === 0) return [];

  // Split on sentence boundaries
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15);

  const claims: HallucinationClaim[] = [];

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();

    // Skip questions
    if (sentence.endsWith("?")) continue;

    // Skip imperatives
    if (imperativePrefixes.some((p) => lower.startsWith(p))) continue;

    // Skip pure opinions (without numbers)
    const isOpinion = opinionPrefixes.some((p) => lower.includes(p));
    const hasNumber = /\d/.test(sentence);
    if (isOpinion && !hasNumber) continue;

    // Must contain factual content: a capitalized word or a number
    const hasCapitalizedWord = /[A-Z][a-z]/.test(sentence);
    if (!hasCapitalizedWord && !hasNumber) continue;

    // Classify confidence
    let confidence: "certain" | "likely" | "uncertain";
    if (uncertainMarkers.some((m) => lower.includes(m))) {
      confidence = "uncertain";
    } else if (certainMarkers.some((m) => {
      // Match as whole word to avoid false positives within longer words
      const regex = new RegExp(`\\b${m}\\b`);
      return regex.test(lower);
    })) {
      confidence = "certain";
    } else {
      confidence = "likely";
    }

    claims.push({ text: sentence, confidence, verified: false });
  }

  return claims;
};

// ─── Keyword Overlap Scoring ───

const computeOverlap = (claimText: string, sourceText: string): number => {
  const claimWords = claimText
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3);

  if (claimWords.length === 0) return 0;

  const sourceWords = new Set(
    sourceText
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3),
  );

  const matchCount = claimWords.filter((w) => sourceWords.has(w)).length;
  return matchCount / claimWords.length;
};

// ─── Heuristic Hallucination Check ───

/**
 * Hallucination Detection Layer (Tier 1: Heuristic)
 *
 * Extracts factual claims from the response, computes keyword overlap
 * against the source text, and flags unsupported claims as potential
 * hallucinations.
 */
export const checkHallucination = (
  response: string,
  source: string,
  threshold: number = 0.10,
): Effect.Effect<LayerResult, never> =>
  Effect.sync(() => {
    const claims = extractClaims(response);

    if (claims.length === 0) {
      return {
        layerName: "hallucination",
        score: 1.0,
        passed: true,
        details: "No factual claims to verify.",
      } satisfies LayerResult;
    }

    // Score each claim against source
    for (const claim of claims) {
      const overlap = computeOverlap(claim.text, source);
      if (overlap >= 0.4) {
        claim.verified = true;
      }
    }

    const verifiedCount = claims.filter((c) => c.verified).length;
    const unverifiedCount = claims.length - verifiedCount;
    const hallucinationRate = unverifiedCount / claims.length;

    // Detect confidence mismatches: claims marked "certain" but low overlap
    const confidenceMismatches = claims.filter((c) => {
      const overlap = computeOverlap(c.text, source);
      return c.confidence === "certain" && overlap < 0.3;
    });

    const score = Math.max(0, Math.min(1, 1 - hallucinationRate));
    const passed = hallucinationRate <= threshold;

    const mismatchNote =
      confidenceMismatches.length > 0
        ? ` Confidence mismatches: ${confidenceMismatches.length} claim(s) marked certain but unsupported.`
        : "";

    return {
      layerName: "hallucination",
      score,
      passed,
      details: `Claims: ${claims.length}, verified: ${verifiedCount}, unverified: ${unverifiedCount}, rate: ${hallucinationRate.toFixed(2)}.${mismatchNote}`,
    } satisfies LayerResult;
  });

// ─── LLM-Based Hallucination Check ───

/**
 * Hallucination Detection Layer (Tier 2: LLM)
 *
 * Prompts the LLM to extract claims from the response and verify
 * each against the provided source text. Falls back to heuristic
 * if LLM output is unparseable.
 */
export const checkHallucinationLLM = (
  response: string,
  source: string,
  llm: LLMServiceLike,
  threshold: number = 0.10,
): Effect.Effect<LayerResult, never> => {
  const heuristicFallback = checkHallucination(response, source, threshold);

  const llmImpl = Effect.gen(function* () {
    const prompt = [
      `You are a hallucination detector. Given a RESPONSE and a SOURCE, extract all factual claims from the RESPONSE and determine if each is supported by the SOURCE.`,
      ``,
      `RESPONSE:`,
      response,
      ``,
      `SOURCE:`,
      source,
      ``,
      `Return ONLY a JSON object with this shape:`,
      `{ "claims": [{ "text": "claim text", "confidence": "certain"|"likely"|"uncertain", "verified": true|false }] }`,
      ``,
      `Rules:`,
      `- "verified" is true ONLY if the claim is directly supported by the SOURCE.`,
      `- "confidence" reflects how confidently the RESPONSE states the claim.`,
      `- Include all factual claims, skip opinions and questions.`,
    ].join("\n");

    const result = yield* llm.complete({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1024,
    });

    // Parse LLM response
    let parsedClaims: HallucinationClaim[];
    try {
      const raw = result.content.trim();
      const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(jsonText);

      if (!parsed.claims || !Array.isArray(parsed.claims)) {
        return yield* heuristicFallback;
      }

      parsedClaims = parsed.claims
        .filter(
          (c: any) =>
            typeof c.text === "string" &&
            typeof c.verified === "boolean" &&
            ["certain", "likely", "uncertain"].includes(c.confidence),
        )
        .map((c: any) => ({
          text: c.text,
          confidence: c.confidence as "certain" | "likely" | "uncertain",
          verified: c.verified,
        }));
    } catch {
      return yield* heuristicFallback;
    }

    if (parsedClaims.length === 0) {
      return {
        layerName: "hallucination",
        score: 1.0,
        passed: true,
        details: "LLM found no factual claims to verify.",
      } satisfies LayerResult;
    }

    const verifiedCount = parsedClaims.filter((c) => c.verified).length;
    const unverifiedCount = parsedClaims.length - verifiedCount;
    const hallucinationRate = unverifiedCount / parsedClaims.length;

    const score = Math.max(0, Math.min(1, 1 - hallucinationRate));
    const passed = hallucinationRate <= threshold;

    return {
      layerName: "hallucination",
      score,
      passed,
      details: `LLM hallucination check: ${parsedClaims.length} claims, verified: ${verifiedCount}, unverified: ${unverifiedCount}, rate: ${hallucinationRate.toFixed(2)}.`,
    } satisfies LayerResult;
  });

  return llmImpl.pipe(Effect.catchAll(() => heuristicFallback));
};
