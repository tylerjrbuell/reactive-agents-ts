// File: src/strategies/shared/quality-utils.ts
/**
 * Shared quality assessment utilities.
 * Used by: Reflexion (isSatisfied, isCritiqueStagnant),
 *           Plan-Execute (isSatisfied), Tree-of-Thought (parseScore).
 */

/**
 * Returns true if the LLM response signals that the task is complete.
 * Matches "SATISFIED:" or "SATISFIED " at the start of the text (line-level),
 * case-insensitive. Also matches when the word "satisfied" appears after
 * a common LLM prefix like "Status:" or newline.
 */
export function isSatisfied(text: string): boolean {
  const trimmed = text.trim();
  // Direct match: "SATISFIED:" or "SATISFIED " at line start (case-insensitive)
  if (/^satisfied[:\s]/im.test(trimmed)) return true;
  // Common LLM patterns: "Status: Satisfied", "\nSatisfied:", "Result: SATISFIED"
  if (/(?:^|\n)\s*(?:status|result|verdict|assessment)?\s*:?\s*satisfied[:\s]/im.test(trimmed)) return true;
  // Thinking-model fallback: verdict may be buried after analysis. Scan full text
  // for "SATISFIED:" that is NOT preceded by "UN" on the same word boundary.
  // Must NOT match "UNSATISFIED".
  if (/(?<![a-z])satisfied\s*:/im.test(trimmed) && !/unsatisfied/im.test(trimmed)) return true;
  return false;
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

// ── Output Sanitization ──────────────────────────────────────────────────────

/**
 * Sanitize agent output before it reaches the user.
 *
 * Strips internal agent metadata that should never appear in user-facing text:
 * - ReAct protocol artifacts ("FINAL ANSWER:", "Thought:", "Action:", "Observation:")
 * - Tool call echoes ("tool/name: {json...}")
 * - Internal step markers ("[STEP 1/3]", "[EXEC s1]", "[SYNTHESIS]", etc.)
 * - Think tags ("<think>...</think>")
 *
 * Applied at buildStrategyResult() to catch all 5 strategies, and as a safety
 * net in the execution engine before TaskResult is returned.
 */
export function sanitizeAgentOutput(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;

  let result = text;

  // Strip <think>...</think> tags (some models emit these)
  result = result.replace(/<think>[\s\S]*?<\/think>/gi, "");

  // Strip "FINAL ANSWER:" prefix
  result = result.replace(/^FINAL ANSWER:\s*/i, "");

  // Strip internal step markers: [STEP 1/3], [EXEC s1], [SYNTHESIS], [REFLECT 1], [SKIP s1], [PATCH]
  result = result.replace(/^\[(?:STEP \d+\/\d+|EXEC s\d+|SYNTHESIS|REFLECT \d+|SKIP s\d+|PATCH)\]\s*/gim, "");

  // Strip "Thought:" / "Action:" / "Action Input:" / "Observation:" protocol prefixes at line start
  result = result.replace(/^(?:Thought|Action|Action Input|Observation):\s*/gim, "");

  // Strip tool call echo lines: "tool/name: {" or "tool_name: {" at line start followed by JSON
  result = result.replace(/^[\w\-]+\/[\w\-]+:\s*\{[^}]*\}\s*$/gm, "");

  // Strip lines that are just raw JSON objects with common internal keys
  result = result.replace(/^\s*\{\s*"(?:recipient|toolName|callId|stepId|_tag)"[^}]*\}\s*$/gm, "");

  // Collapse multiple blank lines into one
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}
