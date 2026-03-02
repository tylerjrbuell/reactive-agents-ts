// File: src/strategies/shared/quality-utils.ts
/**
 * Shared quality assessment utilities.
 * Used by: Reflexion (isSatisfied, isCritiqueStagnant),
 *           Plan-Execute (isSatisfied), Tree-of-Thought (parseScore).
 */

/**
 * Returns true if the LLM response signals that the task is complete.
 * Matches "SATISFIED:" or "SATISFIED " at the start of the text (line-level).
 */
export function isSatisfied(text: string): boolean {
  return /^SATISFIED[:\s]/m.test(text.trim());
}

/**
 * Detects stagnant critiques — if the new critique is substantially the same
 * as the most recent previous one, further retries won't improve the response.
 * Uses normalized substring matching (no heavy Levenshtein needed).
 */
export function isCritiqueStagnant(
  previousCritiques: string[],
  newCritique: string,
): boolean {
  if (previousCritiques.length === 0) return false;
  const lastCritique = previousCritiques[previousCritiques.length - 1]!;
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const a = normalize(lastCritique);
  const b = normalize(newCritique);
  if (a === b) return true;
  // 80% overlap check: if the shorter string's first 80% appears in the longer one
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (
    shorter.length > 20 &&
    longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.8)))
  ) {
    return true;
  }
  return false;
}

/**
 * Robustly parse an LLM-produced score into a [0, 1] float.
 * Handles: "75%", "3/4", "0.8", ".75", "Score: 0.7", "Rating: 7", "1"
 * Strips <think>...</think> tags (some LLMs wrap reasoning in them).
 * Returns 0.5 as a safe default for unparseable input.
 */
export function parseScore(text: string): number {
  // Strip think tags
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const target = stripped.length > 0 ? stripped : text.trim();
  if (target.length === 0) return 0.5;

  // "75%" → 0.75
  const pctMatch = target.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) {
    return Math.max(0, Math.min(1, parseFloat(pctMatch[1]!) / 100));
  }

  // "4/5" or "3/4" → ratio
  const ratioMatch = target.match(/\b(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\b/);
  if (ratioMatch) {
    const num = parseFloat(ratioMatch[1]!);
    const den = parseFloat(ratioMatch[2]!);
    if (den > 0) return Math.max(0, Math.min(1, num / den));
  }

  // "Score: 0.8", "Rating: 7" — if > 1 treat as 0–10 scale
  const labeledMatch = target.match(
    /(?:score|rating|value|grade)\s*[:=]\s*(\d+(?:\.\d+)?)/i,
  );
  if (labeledMatch) {
    const val = parseFloat(labeledMatch[1]!);
    return Math.max(0, Math.min(1, val > 1 ? val / 10 : val));
  }

  // Standard decimal in [0, 1]: "0.75", ".75", "1.0", "0", "1"
  const decMatch = target.match(/\b(1\.0*|0?\.\d+|[01])\b/);
  if (decMatch) {
    return Math.max(0, Math.min(1, parseFloat(decMatch[1]!)));
  }

  return 0.5;
}
