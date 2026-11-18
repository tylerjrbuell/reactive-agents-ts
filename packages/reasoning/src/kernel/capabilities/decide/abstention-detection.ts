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

// ─── Honest decline over a missing input ─────────────────────────────────────
//
// A text that says the task cannot be answered because an input (file, data,
// tool result) is missing. Wider than the capability-refusal patterns above
// ("I cannot determine the total because ./ledger.json could not be found").
// Only consulted when the run's required tool has ALREADY always failed
// (loop/honest-decline-exit.ts), so the bar for the text itself stays modest.

const INABILITY_PATTERNS: readonly RegExp[] = [
  /\b(?:i|we) (?:cannot|can't|can not|could not|couldn't|am unable to|'m unable to|was unable to|were unable to) (?:determine|calculate|compute|provide|find|read|locate|access|retrieve|open|answer|complete|verify|report|give|produce|obtain|get)\b/i,
  /\bunable to (?:determine|calculate|compute|provide|find|read|locate|access|retrieve|open|answer|complete|obtain)\b/i,
  /\b(?:could not|couldn't|cannot|can't|can not|was not|wasn't|is not|isn't) (?:be )?(?:found|read|located|accessed|opened|retrieved|available)\b/i,
  /\b(?:does not|doesn't|did not|didn't) exist\b/i,
  /\bno such file\b/i,
];

/** A file-name or path token: contains a slash, or a dotted extension. */
const PATH_TOKEN = /\S*(?:[\\/]\S*|\.[A-Za-z][A-Za-z0-9]{0,5}\b)\S*/g;

/**
 * True when `text` declines to answer because an input is missing, and carries
 * no figure of its own. A partial answer ("the total so far is 120, but I
 * cannot read b.csv") is NOT a decline: any digit outside a file name or path
 * marks the text as carrying a deliverable. Pure, deterministic, no LLM.
 */
export function looksLikeHonestDecline(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 600) return false;
  if (!INABILITY_PATTERNS.some((p) => p.test(t))) return false;
  return !/\d/.test(t.replace(PATH_TOKEN, " "));
}
