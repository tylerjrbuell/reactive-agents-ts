/**
 * Evidence grounding — deterministic checks that numeric claims in the model's
 * answer appear in tool observation text, to block obvious price / figure hallucinations.
 *
 * Pure functions — no LLM calls. Conservative: only validates `$…` dollar amounts
 * with enough digits to be meaningful; skips when the evidence corpus is too thin.
 */
import type { ReasoningStep } from "../../../types/index.js";

/**
 * Concatenate non-system tool observation bodies from the step log.
 * Used as the authoritative evidence corpus for grounding checks.
 *
 * Prefers the FULL stored value (resolved via `storedKey`→scratchpad) over the
 * compressed step content — the inline preview is lossy, so figures past the
 * truncation cutoff would read as ungrounded against the compressed body.
 */
export function buildEvidenceCorpusFromSteps(
  steps: readonly ReasoningStep[],
  scratchpad?: ReadonlyMap<string, string>,
): string {
  const chunks: string[] = [];
  for (const s of steps) {
    if (s.type !== "observation") continue;
    const tr = s.metadata?.observationResult as { toolName?: string } | undefined;
    const tn = tr?.toolName;
    if (tn === "system" || tn === "final-answer") continue;
    const storedKey = s.metadata?.storedKey as string | undefined;
    const full = storedKey ? scratchpad?.get(storedKey) : undefined;
    const fact = s.metadata?.extractedFact as string | undefined;
    const body = full ?? (typeof s.content === "string" ? s.content : "");
    if (body.trim().length > 0) chunks.push(body);
    if (fact && fact.trim().length > 0) chunks.push(fact);
  }
  return chunks.join("\n\n");
}

function entityAliasMatch(lowerOutput: string, entity: string): boolean {
  if (lowerOutput.includes(entity)) return true;
  if (entity === "bitcoin" && (/\bbtc\b/.test(lowerOutput) || lowerOutput.includes("bitcoin"))) return true;
  if (entity === "ethereum" && (/\beth\b/.test(lowerOutput) || lowerOutput.includes("ethereum"))) return true;
  return false;
}

/**
 * When the task enumerates expected items (from {@link extractOutputFormat}'s `expectedEntities`),
 * require each to appear in the answer (with small ticker aliases for Bitcoin/Ethereum).
 */
export function validateExpectedEntitiesInOutput(
  output: string,
  expectedEntities: readonly string[],
): { readonly ok: true } | { readonly ok: false; readonly violations: readonly string[] } {
  if (expectedEntities.length === 0) return { ok: true };
  const lower = output.toLowerCase();
  const violations: string[] = [];
  for (const e of expectedEntities) {
    if (!entityAliasMatch(lower, e)) {
      violations.push(`task requires "${e}" in the answer but it was not found`);
    }
  }
  if (violations.length === 0) return { ok: true };
  return { ok: false, violations };
}

/** Parse a numeric token (handles $, commas, k/M/B suffixes) → value or null. */
function parseNumericValue(token: string): number | null {
  const cleaned = token.replace(/[$,~≈\\\s]/gi, "").replace(/approx\.?/gi, "").toLowerCase();
  const m = cleaned.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!m) {
    const plain = cleaned.match(/\d+(?:\.\d+)?/);
    return plain ? Number(plain[0]) : null;
  }
  const base = Number(m[1]);
  const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : 1;
  return Number.isFinite(base) ? base * mult : null;
}

/** Extract candidate numeric values from text (dollar amounts + bare ≥3-digit numbers). */
function extractNumericValues(text: string): number[] {
  const values: number[] = [];
  for (const m of text.matchAll(/(?:~|≈|approx\.?\s*)?(?:\\)?\$\s?[\d,]+(?:\.\d+)?(?:\s?[kmbKMB])?/g)) {
    const v = parseNumericValue(m[0]);
    if (v !== null) values.push(v);
  }
  for (const m of text.matchAll(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{3,}(?:\.\d+)?\b/g)) {
    const v = parseNumericValue(m[0]);
    if (v !== null) values.push(v);
  }
  return values;
}

/**
 * Severity for the always-on fabricated-measurement guard. `block` = reject
 * (suppress + retry, then degrade — handled by the runner, same as grounding
 * block-mode); `warn` = advisory; `off` = skip the check entirely.
 */
export type FabricationGuardMode = "off" | "warn" | "block";

/**
 * Resolve the active fabrication-guard mode. Precedence: an explicit per-run
 * value (e.g. a strategy/kernel caller's `ctx.fabricationGuard`) wins; else the
 * `RA_FABRICATION_GUARD` env killswitch (project convention — cf. RA_LAZY_TOOLS);
 * else the always-on default `block`. An unrecognised env value is
 * ignored (falls through to default) so a typo never silently disables the guard.
 */
export function resolveFabricationGuardMode(explicit?: FabricationGuardMode): FabricationGuardMode {
  if (explicit === "off" || explicit === "warn" || explicit === "block") return explicit;
  const env = typeof process !== "undefined" ? process.env?.RA_FABRICATION_GUARD : undefined;
  if (env === "off" || env === "warn" || env === "block") return env;
  return "block";
}

/**
 * Pull every numeric value out of arbitrary text (units stripped). Distinct
 * from {@link extractNumericValues} — this keeps SMALL numbers (e.g. 40, 90)
 * because a fabricated benchmark like "90 ms" must corroborate against a "90"
 * anywhere in the tool-observation corpus, not just ≥3-digit figures.
 */
function extractAllNumbers(text: string): number[] {
  const values: number[] = [];
  for (const m of text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) {
    const v = parseNumericValue(m[0]);
    if (v !== null) values.push(v);
  }
  return values;
}

/**
 * One claimed empirical measurement scraped from the answer — the matched
 * phrase plus the numeric value asserted (already unit-normalised to its bare
 * magnitude; corroboration is magnitude-only, deliberately unit-agnostic).
 */
interface MeasurementClaim {
  readonly phrase: string;
  readonly value: number;
}

/**
 * Patterns whose UNIT alone makes the number an empirical performance
 * measurement — timings and throughput. High-precision: counts, dollar figures,
 * dates, versions, and Big-O notation carry none of these units, so the guard
 * never fires on legitimate non-measurement numbers.
 */
const UNIT_MEASUREMENT_PATTERNS: readonly RegExp[] = [
  // Timing with an explicit duration unit: "150 ms", "1.2s", "90ns", "3 seconds".
  /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:ns|µs|us|ms|nanoseconds?|microseconds?|milliseconds?|seconds?|secs?\b|minutes?\b|mins?\b|hours?\b)/gi,
  // Throughput: "12000 ops/s", "5 MB/s", "300 qps", "2x faster/speedup".
  /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:ops\/s(?:ec)?|requests?\/s(?:ec)?|qps|[kmg]b\/s|x\s*(?:faster|speed-?up))/gi,
];

/** Percentage claim: `N%`. Counted as a measurement ONLY when a perf keyword sits nearby. */
const PERCENT_PATTERN = /(\d+(?:\.\d+)?)\s*%/g;

/**
 * Performance keywords. A bare `N%` is treated as an empirical claim only when
 * one appears in the SAME sentence — so "28% performance improvement",
 * "improvement of approximately 28%, demonstrating the effectiveness of the
 * optimizations", and "reduced latency by 28%" all qualify, while "28% of
 * users" / "20% market share" do not. Sentence-scoping (not a char window)
 * keeps the percent branch precise while tolerating natural phrasing distance.
 */
const PERF_KEYWORD =
  /faster|slower|improv|speed-?up|speedup|reduc|gain|increase|decrease|optimiz|performance|perf\b|efficien|effective|throughput|latency|runtime|benchmark|better|worse/i;

/** Index of the sentence (split on . ! ? newline) containing char position `idx`. */
function sentenceAround(text: string, idx: number): string {
  const start = Math.max(
    text.lastIndexOf(".", idx - 1),
    text.lastIndexOf("!", idx - 1),
    text.lastIndexOf("?", idx - 1),
    text.lastIndexOf("\n", idx - 1),
  );
  let end = text.length;
  for (const ch of [".", "!", "?", "\n"]) {
    const e = text.indexOf(ch, idx);
    if (e !== -1 && e < end) end = e;
  }
  return text.slice(start + 1, end);
}

/**
 * Scrape claimed empirical measurements from the answer: unit-bearing timings /
 * throughput (always), plus percentages whose sentence carries a perf keyword.
 */
function extractMeasurementClaims(output: string): MeasurementClaim[] {
  const claims: MeasurementClaim[] = [];
  for (const pat of UNIT_MEASUREMENT_PATTERNS) {
    for (const m of output.matchAll(pat)) {
      const value = parseNumericValue(m[1]);
      if (value !== null) claims.push({ phrase: m[0].trim(), value });
    }
  }
  for (const m of output.matchAll(PERCENT_PATTERN)) {
    const idx = m.index ?? 0;
    if (!PERF_KEYWORD.test(sentenceAround(output, idx))) continue;
    const value = parseNumericValue(m[1]);
    if (value !== null) claims.push({ phrase: m[0].trim(), value });
  }
  return claims;
}

/**
 * Always-on fabrication guard (default `block`). Detects empirical PERFORMANCE
 * measurements asserted in the final answer (timings, throughput, % speed-ups —
 * e.g. "Original 150 ms → Optimized 90 ms, 40% faster") whose magnitudes appear
 * NOWHERE in the tool-observation corpus. Such numbers cannot have been
 * measured — no tool produced them — so they are fabricated.
 *
 * High-precision by construction: only numbers carrying a perf unit/keyword are
 * candidates (counts, dollar figures, Big-O, sizes are ignored), and a claim is
 * a violation ONLY if unsupported by ANY corpus number within tolerance. When a
 * real benchmark/execution tool ran, its output lands in the corpus and grounds
 * the claim — the guard stays silent. This is the over-action failure mode W2:
 * the agent, pushed to "provide before/after benchmarks" with no execution tool,
 * invents the numbers (trace 01KW372HEJSGT80YYK3MCJFDPY, gpt-4o-mini rw-6).
 */
export function detectFabricatedMeasurement(
  output: string,
  evidence: string,
  tolerance = 0.01,
): { readonly ok: true } | { readonly ok: false; readonly violations: readonly string[] } {
  const claims = extractMeasurementClaims(output);
  if (claims.length === 0) return { ok: true };
  const corpus = extractAllNumbers(evidence);
  const violations: string[] = [];
  for (const claim of claims) {
    const grounded = corpus.some(
      (e) => Math.abs(claim.value - e) <= tolerance * Math.max(Math.abs(claim.value), Math.abs(e), 1),
    );
    if (!grounded) {
      violations.push(`fabricated measurement "${claim.phrase}" — no tool observation produced this value`);
    }
  }
  if (violations.length === 0) return { ok: true };
  return { ok: false, violations };
}

/**
 * Test-suite claim contradicted by the tool evidence — e.g. the answer says
 * "all tests have passed" while the last test-runner invocation in the
 * evidence corpus actually exited non-zero. Distinct from
 * {@link detectFabricatedMeasurement} (which polices UNGROUNDED numeric
 * claims — nothing in the corpus supports them) — this polices a
 * CONTRADICTED boolean claim, where the corpus contains the opposite of what
 * the model asserts. High-precision by construction: only fires when BOTH an
 * explicit test-suite-success phrase appears in the output AND an explicit
 * non-zero exit code appears in the evidence corpus; a corpus with no
 * exit-code signal (or only zero) never trips it, so a real pass is silent.
 *
 * Found via a real-model benchmark trace (cogito:14b, rw-7, 2026-08-15): the
 * model's code-execute call for `bun test` returned
 * `{"result":{"exitCode":1,...}}` (the test run failed), and the model's
 * final answer nonetheless read "All tests have passed successfully after
 * fixing the bugs in each file" — routed through `harness_synthesis`, which
 * only reformats `state.output`'s prose and never re-consults the tool
 * evidence, so nothing in the pipeline caught the contradiction.
 */
const TEST_SUCCESS_CLAIM_RE =
  /\ball\s+tests?\s+(?:have\s+)?(?:passed|pass(?:es|ing)?|succeed(?:ed)?)\b|tests?\s+(?:all\s+)?passed?\s+successfully\b|test\s+suite\s+passes?\b/i;
/** Matches a JSON-shaped non-zero exit code from a code-execute/test-runner tool result. */
const NONZERO_EXIT_CODE_RE = /"exitCode"\s*:\s*(-?[1-9]\d*)/;

export function detectContradictedTestClaim(
  output: string,
  evidence: string,
): { readonly ok: true } | { readonly ok: false; readonly violations: readonly string[] } {
  if (!TEST_SUCCESS_CLAIM_RE.test(output)) return { ok: true };
  const exitMatch = evidence.match(NONZERO_EXIT_CODE_RE);
  if (!exitMatch) return { ok: true };
  return {
    ok: false,
    violations: [
      `claimed tests passed, but the tool evidence shows a test run exiting with code ${exitMatch[1]} (failure)`,
    ],
  };
}

/** An empirical claim classified against the tool-observation corpus. */
export interface ClassifiedClaim {
  readonly phrase: string;
  readonly value: number;
  readonly grounded: boolean;
}

/**
 * Classify EVERY empirical measurement claim in `output` against the corpus,
 * returning each claim's phrase, value, and grounded flag. Same extraction +
 * magnitude-corroboration logic as {@link detectFabricatedMeasurement} — but it
 * surfaces ALL claims (grounded and not) instead of only violation messages, so
 * the RunLedger can record them as first-class `claim` facts (audit 01-F2:
 * claims were previously extracted and DISCARDED). Empty when no claims.
 */
export function classifyMeasurementClaims(
  output: string,
  evidence: string,
  tolerance = 0.01,
): ClassifiedClaim[] {
  const claims = extractMeasurementClaims(output);
  if (claims.length === 0) return [];
  const corpus = extractAllNumbers(evidence);
  return claims.map((claim) => ({
    phrase: claim.phrase,
    value: claim.value,
    grounded: corpus.some(
      (e) => Math.abs(claim.value - e) <= tolerance * Math.max(Math.abs(claim.value), Math.abs(e), 1),
    ),
  }));
}

/**
 * Numeric grounding (opt-in). A figure in `output` is grounded iff some figure
 * in `evidence` is within `tolerance` (fractional). Tolerant value-match — NOT
 * substring — so $62,578 grounds against 62578.12 and $62.5k against 62500.
 * Skips when corpus is thin or output has no numeric claims (never false-reject).
 */
export function validateNumericGrounding(
  output: string,
  evidence: string,
  tolerance: number,
): { readonly ok: true } | { readonly ok: false; readonly violations: readonly string[] } {
  if (evidence.replace(/\s/g, "").length < 20) return { ok: true };
  const corpusValues = extractNumericValues(evidence);
  if (corpusValues.length === 0) return { ok: true };

  // Re-extract output dollar tokens for human-readable violation messages.
  const outDollarTokens = [...output.matchAll(/(?:~|≈|approx\.?\s*)?(?:\\)?\$\s?[\d,]+(?:\.\d+)?(?:\s?[kmbKMB])?/g)].map((m) => m[0]);
  const violations: string[] = [];
  for (const token of outDollarTokens) {
    const c = parseNumericValue(token);
    if (c === null) continue;
    const grounded = corpusValues.some((e) => Math.abs(c - e) <= tolerance * Math.max(Math.abs(c), Math.abs(e)));
    if (!grounded) violations.push(`unverified figure: ${token}`);
  }
  if (violations.length === 0) return { ok: true };
  return { ok: false, violations };
}

/** Matches a markdown table separator row (`|---|---|`, `|:--|--:|`, etc). */
const TABLE_SEPARATOR_RE = /^\s*\|?[\s:|-]+\|?\s*$/;

/** Extract the first cell of each markdown table DATA row (skips the header
 *  row and the `|---|---|` separator). */
function extractTableRowTitles(text: string): string[] {
  const lines = text.split("\n");
  const titles: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("|")) continue;
    if (!TABLE_SEPARATOR_RE.test(line)) continue;
    // `line` is a separator row — the row above it is the header (skip), the
    // rows below it (until a non-table line) are data rows.
    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j];
      if (!row.includes("|") || TABLE_SEPARATOR_RE.test(row)) break;
      const firstCell = row.split("|").map((c) => c.trim()).find((c) => c.length > 0);
      if (firstCell) titles.push(firstCell.replace(/\*\*/g, ""));
    }
  }
  return titles;
}

/** Extract bold titles from bullet/numbered list items (`- **Title** — ...`). */
const BOLD_LIST_ITEM_RE = /^\s*(?:[-*]|\d+[.)])\s+\*\*([^*]+)\*\*/gm;
function extractBoldListTitles(text: string): string[] {
  return [...text.matchAll(BOLD_LIST_ITEM_RE)].map((m) => m[1].trim());
}

/**
 * Fabricated NARRATIVE/factual-entity guard (always-on, part of the fabrication-
 * guard family alongside {@link detectFabricatedMeasurement} and
 * {@link detectContradictedTestClaim}). Those two police ungrounded NUMBERS and
 * CONTRADICTED booleans; this one polices wholesale-invented NAMED ITEMS —
 * markdown table rows or bolded list entries presented as researched facts
 * (episode titles, product names, article headlines) that appear nowhere in
 * the tool-observation corpus.
 *
 * Found via a real-model trace (gemma4:e4b, `plan-execute-reflect`,
 * 2026-08-15): asked to research and table episode names/descriptions for a
 * TV season, the model got back 5 vague web-search snippets with no episode
 * breakdown, then its synthesis step INVENTED 9 complete episode titles +
 * descriptions wholesale ("Mike and the Forgotten Path", "The River's
 * Embrace" — none of these exist, none grounded in any observation). The
 * self-verify + final verifier both rubber-stamped it because nothing checked
 * narrative claims — only numbers.
 *
 * High-precision by construction, same discipline as the numeric guard:
 * - Only extracts candidates from STRUCTURED list positions (markdown table
 *   first-cell, or bolded bullet/numbered-list titles) — free-form prose
 *   claims are not policed here (that would need real NER, an LLM call, which
 *   this file deliberately avoids).
 * - Requires >=2 candidates before firing at all — a single listed item is
 *   too little signal (could be a legitimate one-row summary).
 * - Fires only when ALL candidates are ungrounded (zero overlap with the
 *   corpus), not just some — a mix of grounded/ungrounded rows is far more
 *   likely to be paraphrasing or formatting drift than fabrication, and this
 *   guard is tuned to catch wholesale invention (the trace's failure mode),
 *   not flag every imperfect table. Precision over recall, same tradeoff the
 *   numeric guard documents for Big-O/counts/dollar-figures.
 */
export function detectFabricatedListedEntities(
  output: string,
  evidence: string,
): { readonly ok: true } | { readonly ok: false; readonly violations: readonly string[] } {
  const candidates = [...extractTableRowTitles(output), ...extractBoldListTitles(output)].filter(
    (t) => t.length >= 4 && /[a-zA-Z]{3,}/.test(t),
  );
  if (candidates.length < 2) return { ok: true };

  const corpusLower = evidence.toLowerCase().replace(/\s+/g, " ");
  const ungrounded = candidates.filter(
    (title) => !corpusLower.includes(title.toLowerCase().replace(/\s+/g, " ")),
  );
  if (ungrounded.length < candidates.length) return { ok: true };

  return {
    ok: false,
    violations: [
      `${candidates.length} listed items (e.g. "${candidates[0]}"${
        candidates[1] ? `, "${candidates[1]}"` : ""
      }) appear nowhere in the tool evidence — likely invented, not researched`,
    ],
  };
}
