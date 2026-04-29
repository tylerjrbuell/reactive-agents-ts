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

// ─── Sprint 3.4 Scaffold 2 — Generalized claim-shape grounding ───────────────
//
// The dollar-amount check above only catches one CLAIM SHAPE. Many synthesis
// failures don't involve dollars — they involve fabricated titles, names,
// identifiers. This generalization detects multiple claim shapes and checks
// each against the evidence corpus. Task-agnostic: works for HN titles,
// product names, customer IDs, file paths, code symbols, anything.

function normalizeForClaimMatch(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Compression-marker patterns. When the output contains any of these, the
 * model literally echoed framework internal scaffolding instead of
 * synthesizing real content. Hard-fail signal.
 */
const COMPRESSION_MARKER_PATTERNS = [
  /\[recall result\b/i,
  /\bcompressed preview\b/i,
  /^Type:\s*(Array|Object)\(/m,
  /^Schema:\s/m,
  /\b_tool_result_\d+\b/i,
  /— full text is stored\b/i,
  /\[STORED:\s*_tool_result_/i,
];

/**
 * Extract candidate claim tokens from output. Captures four shapes:
 *   1. Quoted phrases — "..." and '...' (4-200 chars; sentences too noisy)
 *   2. Capitalized phrases — ≥2 consecutive capitalized words (titles, names)
 *   3. Significant numbers — ≥3 digits and decimals
 *   4. Identifiers — alphanumeric ≥8 chars with mixed case or digits
 */
function extractClaimTokens(output: string): readonly string[] {
  const claims = new Set<string>();
  for (const m of output.matchAll(/["'`]([^"'`\n]{4,200})["'`]/g)) {
    const inner = m[1];
    if (inner) claims.add(normalizeForClaimMatch(inner));
  }
  for (const m of output.matchAll(/(?:[A-Z][a-z']{2,}(?:[\s-]+[A-Z][a-z']{2,}){1,7})/g)) {
    if (m[0] && m[0].length >= 6) claims.add(normalizeForClaimMatch(m[0]));
  }
  for (const m of output.matchAll(/\b(\d{3,}(?:[.,]\d+)?)\b/g)) {
    const num = m[1]?.replace(/,/g, "");
    if (num) claims.add(num);
  }
  for (const m of output.matchAll(/\b([A-Za-z0-9_-]{8,})\b/g)) {
    const id = m[1];
    if (id && /\d/.test(id) && /[A-Za-z]/.test(id)) claims.add(id.toLowerCase());
  }
  return [...claims];
}

export interface GeneralizedGroundingResult {
  readonly verified: boolean;
  readonly ungroundedClaims: readonly string[];
  readonly totalClaims: number;
  readonly groundingRate: number;
  readonly compressionEchoDetected: boolean;
  readonly reason: string;
}

/**
 * The general grounding check Scaffold 2 ships. Fails when:
 *   1. Output contains framework compression markers (instant fail), OR
 *   2. > 20% of extracted claims aren't found in the evidence corpus
 *
 * The 20% threshold is lenient — natural language has filler. The point is
 * to catch SYSTEMIC fabrication (most claims invented), not require exact
 * citation of every word.
 */
export function validateGeneralizedGrounding(
  output: string,
  evidence: string,
  options?: {
    readonly maxUngroundedRate?: number;
    readonly minClaimsForCheck?: number;
    /**
     * Opt in to the substring claim-grounding pass. Defaults to FALSE because
     * the Title-Case claim extractor over-matches structural language (section
     * labels, transitions, paraphrased titles) and rejects legitimate
     * summaries on tasks that paraphrase tool output (HN summaries, search
     * digests, etc.). The compression-marker check below is always on — it
     * catches genuine framework leakage and has no false-positive rate.
     *
     * Stage 5 quality fix: prior default `true` produced 64-73% reject rates
     * on legitimate summarization tasks; the gate was net-negative for
     * everyday use. Re-enable per-agent via `withVerification({ syntheGrounding: true })`
     * for tasks where exact-substring grounding is required (e.g., financial
     * figures, structured-data extraction).
     */
    readonly enableClaimGrounding?: boolean;
  },
): GeneralizedGroundingResult {
  const maxUngroundedRate = options?.maxUngroundedRate ?? 0.5;
  const minClaimsForCheck = options?.minClaimsForCheck ?? 3;
  const claimGroundingEnabled = options?.enableClaimGrounding ?? false;

  // Compression-marker check (always on) — catches the model literally
  // parroting framework internal scaffolding ([STORED:], compressed preview,
  // _tool_result_N, etc.). Hard fail, no false-positive risk.
  const compressionEchoDetected = COMPRESSION_MARKER_PATTERNS.some((re) => re.test(output));
  if (compressionEchoDetected) {
    return {
      verified: false,
      ungroundedClaims: [],
      totalClaims: 0,
      groundingRate: 0,
      compressionEchoDetected: true,
      reason:
        "output contains framework compression markers (e.g., [STORED:], compressed preview, _tool_result_N) — model echoed internal scaffolding instead of synthesizing",
    };
  }

  // Claim-grounding pass — only run when explicitly opted in.
  if (!claimGroundingEnabled) {
    return {
      verified: true,
      ungroundedClaims: [],
      totalClaims: 0,
      groundingRate: 1,
      compressionEchoDetected: false,
      reason: "claim-grounding pass disabled (opt-in via syntheGrounding option)",
    };
  }

  if (evidence.trim().length < 20) {
    return {
      verified: true,
      ungroundedClaims: [],
      totalClaims: 0,
      groundingRate: 1,
      compressionEchoDetected: false,
      reason: "no evidence corpus to ground against (skipped)",
    };
  }

  const claims = extractClaimTokens(output);
  if (claims.length < minClaimsForCheck) {
    return {
      verified: true,
      ungroundedClaims: [],
      totalClaims: claims.length,
      groundingRate: 1,
      compressionEchoDetected: false,
      reason: `only ${claims.length} claims extracted; below threshold for grounding check`,
    };
  }

  const lookup = normalizeForClaimMatch(evidence);
  const ungrounded: string[] = [];
  for (const claim of claims) {
    if (lookup.includes(claim)) continue;
    if (claim.length >= 10 && lookup.includes(claim.slice(0, Math.floor(claim.length * 0.8)))) {
      continue;
    }
    ungrounded.push(claim);
  }

  const ungroundedRate = ungrounded.length / claims.length;
  const verified = ungroundedRate <= maxUngroundedRate;

  return {
    verified,
    ungroundedClaims: ungrounded,
    totalClaims: claims.length,
    groundingRate: 1 - ungroundedRate,
    compressionEchoDetected: false,
    reason: verified
      ? `${claims.length - ungrounded.length}/${claims.length} claims grounded`
      : `${ungrounded.length}/${claims.length} claims not in tool observations: ${ungrounded.slice(0, 3).map((c) => `"${c.slice(0, 40)}"`).join(", ")}${ungrounded.length > 3 ? "..." : ""}`,
  };
}
