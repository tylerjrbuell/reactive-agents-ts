/**
 * field-provenance — per-field grounding against a step-corpus string.
 *
 * Pure functions; no LLM calls. Used by the grounded engine orchestrator (Task 2.4)
 * to annotate structured-output fields with evidence citations and confidence scores.
 */

// ── Public types ────────────────────────────────────────────────────────────

export interface GroundResult {
  readonly provenance: Record<string, { source: string; evidence: string }>;
  readonly confidence: Record<string, number>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract evidence snippet centred on `idx` inside `corpus`.
 */
function snippet(corpus: string, idx: number, needleLen: number): string {
  const start = Math.max(0, idx - 30);
  return corpus.slice(start, idx + needleLen + 30);
}

/**
 * Tolerant numeric search: find `val` in `corpus` allowing for comma-formatted
 * numbers, optional `$` prefix, and minor floating-point differences (0.1%).
 *
 * Examples: 64000 matches "64,000", "$64000", "64000.0" in corpus.
 *
 * TODO: integrate `validateNumericGrounding` from
 * `../../../kernel/capabilities/verify/evidence-grounding` for the full
 * dollar-token grounding pipeline once its interface supports field-value
 * lookup (currently it validates $-tokens in an output string, not
 * arbitrary numeric values).
 */
function findNumericInCorpus(
  val: number,
  corpus: string,
): number {
  // Regex: optional $, then a run of digits (with optional embedded commas), optional decimal.
  // Using \d[\d,]* instead of the comma-group alternation avoids the {1,3} cap that
  // splits bare runs like "64000" into "640"+"00".
  const pattern = /[$]?\d[\d,]*(?:\.\d+)?/g;
  const tolerance = 0.001; // 0.1%
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(corpus)) !== null) {
    const raw = match[0].replace(/[$,]/g, "");
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      const denom = Math.max(Math.abs(val), Math.abs(parsed));
      if (denom === 0 || Math.abs(val - parsed) <= tolerance * denom) {
        return match.index;
      }
    }
  }
  return -1;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Ground each field in `obj` against the `corpus` string (concatenated step
 * observations). Returns:
 *   - `provenance[field]` — set when a match was found; carries `source` tag
 *     and an excerpt `evidence` string around the match position.
 *   - `confidence[field]` — 0.9 when grounded, 0.4 when ungrounded (parametric).
 *
 * Skips `null` and `undefined` values (no entry in either map).
 *
 * Matching strategy:
 *   - String / boolean / other: exact `indexOf` of `String(val)` (min 2 chars).
 *   - Number: tolerant numeric match via inline regex (handles comma formatting,
 *     optional `$`, and ±0.1% floating-point tolerance).
 */
export function groundFields(obj: Record<string, unknown>, corpus: string): GroundResult {
  const provenance: GroundResult["provenance"] = {};
  const confidence: GroundResult["confidence"] = {};

  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;

    let idx = -1;
    let needleLen = 0;

    if (typeof val === "number") {
      // Tolerant numeric match so 64000 grounds against "64,000" or "$64000".
      idx = findNumericInCorpus(val, corpus);
      needleLen = String(val).length;
    } else {
      const needle = String(val);
      if (needle.length >= 2) {
        idx = corpus.indexOf(needle);
        needleLen = needle.length;
      }
    }

    if (idx >= 0) {
      provenance[key] = {
        source: "step-corpus",
        evidence: snippet(corpus, idx, needleLen),
      };
      confidence[key] = 0.9;
    } else {
      confidence[key] = 0.4; // ungrounded / parametric — honest lower confidence
    }
  }

  return { provenance, confidence };
}
