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

const WORD_CHAR = /\w/;

/**
 * Boundary-aware substring search. A word-like needle (starts/ends with a word
 * char) must not be embedded inside a larger alphanumeric token — otherwise
 * "cat" would falsely "ground" against "concatenate". Needles whose edges are
 * punctuation match anywhere. Returns the match index or -1.
 */
function findWithBoundary(needle: string, corpus: string): number {
  if (needle.length === 0) return -1;
  const needleStartsWord = WORD_CHAR.test(needle[0]!);
  const needleEndsWord = WORD_CHAR.test(needle[needle.length - 1]!);

  let from = 0;
  for (;;) {
    const idx = corpus.indexOf(needle, from);
    if (idx < 0) return -1;
    const before = idx > 0 ? corpus[idx - 1]! : "";
    const afterPos = idx + needle.length;
    const after = afterPos < corpus.length ? corpus[afterPos]! : "";
    const beforeOk = !needleStartsWord || before === "" || !WORD_CHAR.test(before);
    const afterOk = !needleEndsWord || after === "" || !WORD_CHAR.test(after);
    if (beforeOk && afterOk) return idx;
    from = idx + 1;
  }
}

/**
 * Ground a single leaf value at `path`, mutating the provenance/confidence maps.
 * Recurses into arrays and plain objects, keying nested leaves by dotted path
 * (e.g. `meta.ticker`, `sources.0`). Skips `null`/`undefined`.
 */
function groundValue(
  path: string,
  val: unknown,
  corpus: string,
  provenance: GroundResult["provenance"],
  confidence: GroundResult["confidence"],
): void {
  if (val === undefined || val === null) return;

  if (Array.isArray(val)) {
    val.forEach((v, i) => groundValue(`${path}.${i}`, v, corpus, provenance, confidence));
    return;
  }
  if (typeof val === "object") {
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      groundValue(`${path}.${k}`, v, corpus, provenance, confidence);
    }
    return;
  }

  let idx = -1;
  let needleLen = 0;

  if (typeof val === "number") {
    // Tolerant numeric match so 64000 grounds against "64,000" or "$64000".
    idx = findNumericInCorpus(val, corpus);
    needleLen = String(val).length;
  } else {
    const needle = String(val);
    if (needle.length >= 2) {
      idx = findWithBoundary(needle, corpus);
      needleLen = needle.length;
    }
  }

  if (idx >= 0) {
    provenance[path] = {
      source: "step-corpus",
      evidence: snippet(corpus, idx, needleLen),
    };
    confidence[path] = 0.9;
  } else {
    confidence[path] = 0.4; // ungrounded / parametric — honest lower confidence
  }
}

/**
 * Ground each field in `obj` against the `corpus` string (concatenated step
 * observations). Returns:
 *   - `provenance[path]` — set when a match was found; carries `source` tag
 *     and an excerpt `evidence` string around the match position.
 *   - `confidence[path]` — 0.9 when grounded, 0.4 when ungrounded (parametric).
 *
 * Nested objects/arrays are grounded recursively; nested leaves are keyed by
 * dotted path (`meta.ticker`, `sources.0`). Top-level scalar fields keep their
 * plain key. Skips `null` and `undefined` values (no entry in either map).
 *
 * Matching strategy:
 *   - String / boolean / other: boundary-aware substring match of `String(val)`
 *     (min 2 chars) — rejects coincidental embedding in a larger token.
 *   - Number: tolerant numeric match via inline regex (handles comma formatting,
 *     optional `$`, and ±0.1% floating-point tolerance).
 */
export function groundFields(obj: Record<string, unknown>, corpus: string): GroundResult {
  const provenance: GroundResult["provenance"] = {};
  const confidence: GroundResult["confidence"] = {};

  for (const [key, val] of Object.entries(obj)) {
    groundValue(key, val, corpus, provenance, confidence);
  }

  return { provenance, confidence };
}
