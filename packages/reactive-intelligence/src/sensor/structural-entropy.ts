import type { StructuralEntropy } from "../types.js";

const HEDGE_PHRASES = [
  "might", "could", "perhaps", "possibly", "maybe",
  "i think", "i believe", "it seems", "probably", "likely",
  "not sure", "uncertain", "approximately", "roughly",
];

/**
 * Compute structural entropy from a reasoning step's text.
 * Always available, sync, <1ms. LM-Polygraph validates heuristics
 * as effective for short structured outputs.
 */
export function computeStructuralEntropy(
  thought: string,
  strategy: string,
): StructuralEntropy {
  const lower = thought.toLowerCase();

  // ── Format compliance: does output match expected structure? ──
  let formatCompliance = 0.5; // neutral default
  if (strategy === "reactive" || strategy === "react") {
    const hasThought = /thought:/i.test(thought);
    const hasAction = /action:/i.test(thought);
    const hasFinalAnswer = /final answer/i.test(thought);
    if (hasThought && (hasAction || hasFinalAnswer)) formatCompliance = 1.0;
    else if (hasThought || hasAction) formatCompliance = 0.7;
    else formatCompliance = 0.3;
  } else if (strategy === "plan-execute") {
    const hasStep = /step\s*\d/i.test(thought);
    formatCompliance = hasStep ? 0.9 : 0.4;
  } else {
    formatCompliance = 0.6; // unknown strategy, neutral
  }

  // ── Order integrity: structural elements in correct sequence? ──
  let orderIntegrity = 1.0;
  if (strategy === "reactive" || strategy === "react") {
    const thoughtIdx = thought.search(/thought:/i);
    const actionIdx = thought.search(/action:/i);
    if (thoughtIdx >= 0 && actionIdx >= 0 && actionIdx < thoughtIdx) {
      orderIntegrity = 0.3; // Action before Thought = bad
    }
  }

  // ── Thought density: unique meaningful words / total words ──
  const words = lower.split(/\s+/).filter((w) => w.length > 2);
  const unique = new Set(words);
  const thoughtDensity = words.length > 0 ? unique.size / words.length : 0;

  // ── Vocabulary diversity: type-token ratio ──
  const allWords = lower.split(/\s+/).filter((w) => w.length > 0);
  const allUnique = new Set(allWords);
  const vocabularyDiversity =
    allWords.length > 0 ? allUnique.size / allWords.length : 0;

  // ── Hedge score: 1.0 = no hedging, lower = more hedging ──
  const hedgeCount = HEDGE_PHRASES.filter((h) => lower.includes(h)).length;
  const hedgeScore = 1 - Math.min(0.3, hedgeCount * 0.1);

  // ── JSON parse score: for tool calls ──
  let jsonParseScore = 1.0; // default: no JSON expected
  const jsonMatch = thought.match(/\{[\s\S]*$/);
  if (jsonMatch) {
    try {
      // Find the largest balanced JSON substring
      const jsonStr = extractJson(thought);
      if (jsonStr) {
        JSON.parse(jsonStr);
        jsonParseScore = 1.0;
      } else {
        jsonParseScore = 0.5; // has { but can't extract balanced JSON
      }
    } catch {
      jsonParseScore = 0.5; // fixable parse error
    }
  }

  return {
    formatCompliance,
    orderIntegrity,
    thoughtDensity,
    vocabularyDiversity,
    hedgeScore,
    jsonParseScore,
  };
}

/** Extract the first balanced JSON object from text, or null. */
function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null; // unbalanced
}
