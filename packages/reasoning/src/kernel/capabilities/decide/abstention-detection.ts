/**
 * decide/abstention-detection.ts — semantic abstention patterns.
 *
 * looksLikeSemanticAbstention: detects a final-answer tool output that is
 * honestly declining rather than answering. Moved verbatim from
 * `arbitrator.ts` (GH #220 / quality program Task 7). Internal to the decide/
 * cluster (arbitrateInner imports it).
 */

// ─── Semantic abstention detection ───────────────────────────────────────────
//
// Detects when a final-answer tool output is semantically an abstention — the
// model is honestly declining rather than answering. Patterns are narrow to
// avoid false positives on legitimate answers that mention inability in passing.
// A long output (>500 chars) is assumed substantive, not a refusal.

const ABSTENTION_PATTERNS: readonly RegExp[] = [
  /\bi (?:cannot|can't|am unable to|'m unable to) (?:complete|perform|accomplish|fulfill|do|carry out|execute|access|connect to|reach|query) /i,
  /\bi (?:do not|don't) have (?:access to|the ability to|the capability to|the tools to|the means to|a connection to|a way to)/i,
  /\bnot possible for me to (?:complete|perform|accomplish|access|connect|do)/i,
  /\bbeyond my (?:capabilities|ability|capacity)\b/i,
  /\bi lack (?:the (?:ability|access|tools|capability) to|access to)/i,
  /\bno (?:access|ability|way|means) to (?:complete|perform|accomplish|access|connect|query|execute)/i,
];

export function looksLikeSemanticAbstention(output: string): boolean {
  if (output.length > 500) return false;
  return ABSTENTION_PATTERNS.some((p) => p.test(output));
}
