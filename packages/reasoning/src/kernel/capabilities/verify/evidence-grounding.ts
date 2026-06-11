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
