/**
 * Think phase — final-answer reasonability heuristics.
 *
 * Moved verbatim from `think.ts` (GH #219 / HS-249 decomposition). The
 * planning-pattern blocklist and the two prose classifiers the
 * auto-promotion short-circuits in `dispatch-think-response.ts` compose
 * (`looksLikeCompleteProse` for no-tool conversations, `looksLikeFinalAnswer`
 * for structured research-style answers). Re-exported from `think.ts` so
 * existing import paths still resolve.
 */

// Strong negative signals — these are planning patterns, not answers. Use
// word-boundary matches so the heuristic doesn't fire on substring mentions
// like "I should explain..." in a real answer.
const PLANNING_PATTERNS = [
  /\b(?:i (?:should|need to|will|am going to|'ll|'m going to) (?:call|use|invoke|fetch|search|look up|check)\b)/i,
  /\b(?:let me (?:call|use|invoke|fetch|try|check|verify|search)\b)/i,
  /\bnext (?:step|i'll|i will|i should)\b/i,
  /\b(?:i (?:don't|do not) have (?:enough|the)) (?:information|data|context)\b/i,
  /^(?:thinking|reasoning|planning|analysis)\b/i,
];

/**
 * Weaker completeness check than {@link looksLikeFinalAnswer}: substantial,
 * coherent prose that doesn't read like the model is still planning its next
 * move. No structural-signal requirement (no header/list/"in summary" etc.) —
 * appropriate ONLY when no tool was ever required or used this run, where a
 * plain conversational reply IS the answer and shouldn't need research-answer
 * formatting to be trusted as complete.
 */
export function looksLikeCompleteProse(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 100) return false;
  return !PLANNING_PATTERNS.some((re) => re.test(trimmed));
}

export function looksLikeFinalAnswer(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 100) return false;
  if (PLANNING_PATTERNS.some((re) => re.test(trimmed))) return false;

  // Positive signals — structural indicators that this IS the answer.
  const positiveSignals = [
    /^#{1,3}\s+\w/m,                          // markdown header at line start
    /^\s*\d+\.\s+\w/m,                         // numbered list
    /^\s*[-*]\s+\w/m,                          // bulleted list
    /^\s*\|.+\|/m,                             // markdown table row
    /```/,                                     // code block
    /\b(?:final answer|in (?:summary|conclusion)|here (?:is|are)|the (?:result|answer|output) is)\b/i,
  ];
  return positiveSignals.some((re) => re.test(trimmed));
}
