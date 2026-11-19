// File: src/kernel/capabilities/verify/contradicted-empty.ts
//
// A "nothing found" answer that the run's own tool results contradict.
// Deterministic and narrow (no LLM judge).
//
// Cortex trace 01M7T7BJMFHVT2PCHNYWMG9S4P (2026-11-19, gpt-4o, code-action):
// `umami/list_websites` succeeded and returned one website, the code read it by
// a wrong field, and returned "No website available for analysis.". The run was
// graded success.
//
// The rule: an answer is contradicted when it is empty, or is a short
// negative-existence claim about something the tool results do contain, while
// at least one successful tool call in the run returned data. "Returned data"
// means a non-empty list somewhere in the result, or a non-empty text result
// that is not itself a nothing-found claim. A claim names something when it
// shares a word with the tool's name or the result's top-level keys, or when it
// denies data in general ("no data", "no results").

/** One successful tool call: its name and the value it returned. */
export interface ToolEvidence {
  readonly name: string;
  readonly result: unknown;
}

/** Why an answer is contradicted: the answer rendered as JSON and the call that disproves it. */
export interface EmptyContradiction {
  readonly answer: string;
  readonly contradictedBy: string;
}

/** Longest text judged as a nothing-found claim; longer text is an answer with content. */
const MAX_CLAIM_CHARS = 200;
/** Nesting levels searched for a non-empty list. */
const MAX_DEPTH = 3;

const NEGATIVE_CLAIM: readonly RegExp[] = [
  /^\s*(?:no|none|nothing|zero)\b/i,
  /\b(?:not found|not available|unavailable|could ?n[o']t find|could not find|unable to (?:find|locate)|nothing (?:found|to))\b/i,
  /\bno\s+(?:\w+\s+){0,4}?(?:found|available|exists?|returned)\b/i,
];

/** Words that deny data in general: such a claim contradicts any data. */
const GENERIC_NOUNS: ReadonlySet<string> = new Set(["data", "result", "record", "entry", "item", "information", "info"]);

/** Words that carry no subject in a claim. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "found", "available", "unavailable", "analysis", "analyze", "report", "could", "unable", "nothing",
  "none", "there", "were", "have", "with", "that", "this", "from", "returned", "exist", "exists",
  "locate", "find", "show", "display", "your", "account", "matching", "given",
]);

const stem = (word: string): string => {
  const w = word.toLowerCase();
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("es") && w.length > 4 && /(?:ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
};

const words = (text: string): string[] =>
  text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .filter((w) => w.length >= 3)
    .map(stem);

/** True when the text is a short claim that something does not exist or was not found. */
export function isNothingFoundClaim(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= MAX_CLAIM_CHARS && NEGATIVE_CLAIM.some((re) => re.test(t));
}

/** True for null, undefined, "", [] and {}. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

const hasNonEmptyList = (value: unknown, depth: number): boolean => {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== "object" || value === null || depth >= MAX_DEPTH) return false;
  return Object.values(value).some((v) => hasNonEmptyList(v, depth + 1));
};

/** True when a tool result carries data: a non-empty list, or text that is not a nothing-found claim. */
export function carriesData(result: unknown): boolean {
  if (typeof result === "string") return result.trim().length > 0 && !isNothingFoundClaim(result);
  return hasNonEmptyList(result, 0);
}

const evidenceWords = (call: ToolEvidence): Set<string> => {
  const keys = typeof call.result === "object" && call.result !== null && !Array.isArray(call.result)
    ? Object.keys(call.result).join(" ")
    : "";
  return new Set(words(`${call.name} ${keys}`));
};

const claimNames = (claim: string, call: ToolEvidence): boolean => {
  const subjects = words(claim).filter((w) => !STOP_WORDS.has(w));
  if (subjects.some((w) => GENERIC_NOUNS.has(w))) return true;
  const known = evidenceWords(call);
  return subjects.some((w) => known.has(w));
};

/**
 * The contradiction when `answer` reports nothing found but a successful call
 * in `evidence` returned data about it; undefined otherwise (including when no
 * call returned data, or the answer has content).
 *
 * @param answer - the run's final value
 * @param evidence - every successful tool call of the run
 */
export function contradictedEmptyAnswer(answer: unknown, evidence: readonly ToolEvidence[]): EmptyContradiction | undefined {
  const withData = evidence.filter((call) => carriesData(call.result));
  if (withData.length === 0) return undefined;
  if (isEmptyValue(answer)) {
    const first = withData[0];
    return first === undefined ? undefined : { answer: JSON.stringify(answer) ?? "undefined", contradictedBy: first.name };
  }
  if (typeof answer !== "string" || !isNothingFoundClaim(answer)) return undefined;
  const call = withData.find((c) => claimNames(answer, c));
  return call === undefined ? undefined : { answer: JSON.stringify(answer.trim()), contradictedBy: call.name };
}
