/**
 * Evidence grounding — deterministic checks that numeric claims in the model's
 * answer appear in tool observation text, to block obvious price / figure hallucinations.
 *
 * Pure functions — no LLM calls. Conservative: only validates `$…` dollar amounts
 * with enough digits to be meaningful; skips when the evidence corpus is too thin.
 */
import type { ReasoningStep } from "../../../types/index.js";

/** Strip $, commas, spaces; keep digits and decimal for substring checks. */
function normalizeForDigitMatch(s: string): string {
  return s.replace(/[$,\s]/g, "").toLowerCase();
}

/** Pull the first major numeric token from a dollar-like fragment (handles ~$68,000 and \\$65,000). */
function primaryNumericKey(amountToken: string): string {
  const cleaned = amountToken.replace(/[~≈\\]/g, "").replace(/approx\.?/gi, "").trim();
  const m = cleaned.match(/[\d,]+(?:\.\d+)?/);
  return m ? m[0].replace(/,/g, "").toLowerCase() : "";
}

/**
 * Concatenate non-system tool observation bodies from the step log.
 * Used as the authoritative evidence corpus for grounding checks.
 */
export function buildEvidenceCorpusFromSteps(steps: readonly ReasoningStep[]): string {
  const chunks: string[] = [];
  for (const s of steps) {
    if (s.type !== "observation") continue;
    const tr = s.metadata?.observationResult as { toolName?: string } | undefined;
    const tn = tr?.toolName;
    if (tn === "system" || tn === "final-answer") continue;
    if (typeof s.content === "string" && s.content.trim().length > 0) {
      chunks.push(s.content);
    }
  }
  return chunks.join("\n\n");
}

/**
 * Extract unique dollar-like amounts from model output.
 * Covers: `$71,535`, `~$68,000`, `$\approx \$65,000$` (LaTeX-style), optional `approx` / `≈` prefixes.
 */
function extractDollarAmounts(output: string): readonly string[] {
  const re = /(?:~|≈|approx\.?\s*)?(?:\\)?\$[\d,]+(?:\.\d+)?/gi;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    found.push(m[0]);
  }
  return [...new Set(found)];
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

function significantDigitCount(normalizedCore: string): number {
  return normalizedCore.replace(/\D/g, "").length;
}

/**
 * Returns violations when any `$…` amount in `output` does not appear (after comma
 * normalization) in `evidence`. Empty evidence or amounts with fewer than 3 significant
 * digits are skipped to reduce false positives.
 */
export function validateOutputGroundedInEvidence(
  output: string,
  evidence: string,
): { readonly ok: true } | { readonly ok: false; readonly violations: readonly string[] } {
  const evFlat = normalizeForDigitMatch(evidence);
  if (evFlat.length < 20) {
    return { ok: true };
  }

  const amounts = extractDollarAmounts(output);
  if (amounts.length === 0) {
    return { ok: true };
  }

  const violations: string[] = [];
  for (const amt of amounts) {
    const core = primaryNumericKey(amt);
    if (significantDigitCount(core) < 3) continue;
    if (!evFlat.includes(core)) {
      violations.push(`amount ${amt} not found in tool observations`);
    }
  }

  if (violations.length === 0) return { ok: true };
  return { ok: false, violations };
}
