/**
 * Incremental partial-JSON parser for streaming structured output.
 *
 * `parsePartial(buf)` accepts a possibly-truncated prefix of a JSON object
 * and returns the best-effort parsed object so far.
 *
 * Chosen partial-string-value behavior: DROP.
 *   A dangling `"key":"Par` (partial string) lives after the last stable comma,
 *   so the result rewinds past it. The field is absent rather than appearing
 *   with a truncated value — callers only see values that were fully received.
 *
 * Strategy (three-tier fallback):
 *   1. Last-stable-cut (with open-container closers appended): find the last
 *      position after a complete structural value boundary; build a valid
 *      JSON string from there. This drops dangling keys/partial values.
 *   2. Full-buffer close (close open string + open brackets): works when the
 *      buffer ends between top-level fields or at a bracket boundary, but may
 *      produce garbage for partial string values — so it is tried AFTER step 1.
 *   3. repairJson fallback on the full trimmed buffer.
 *   4. Return {}.
 */

import { repairJson } from "./json-repair.js";

/**
 * Cap on how many stable-cut snapshots Tier 1 re-parses (latest-first) before
 * deferring to the full-buffer tiers. Bounds worst-case work per call to O(K)
 * parses instead of O(snapshots); large enough to cover realistic nesting.
 */
const MAX_WALKBACK = 64;

/** A snapshot of the bracket stack at a stable cut point. */
interface CutSnapshot {
  /** Exclusive end index into the trimmed buffer. */
  index: number;
  /** Copy of the bracket stack at this cut (closers to append, LIFO). */
  stack: string[];
}

/**
 * Walk the buffer and collect all stable-cut snapshots.
 *
 * A stable cut is recorded at index+1 after any of these characters
 * seen OUTSIDE a string literal:
 *   - `,`  (sibling separator — we just finished a complete key-value pair)
 *   - `{`  (start of nested object at depth > 1 — the container has started)
 *   - `[`  (start of nested array at depth > 1 — the container has started)
 *   - `}`  (close of nested object — complete nested value at depth ≥ 1 before pop)
 *   - `]`  (close of nested array  — complete nested value at depth ≥ 1 before pop)
 *
 * We only record cuts when we are inside at least one open container (depth ≥ 1),
 * i.e. we never cut at the very root level close `}`.
 *
 * Returns snapshots array and the final walk state.
 */
function walkBuffer(text: string): {
  snapshots: CutSnapshot[];
  finalStack: string[];
  finalInStr: boolean;
} {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  const snapshots: CutSnapshot[] = [];

  const record = (idx: number): void => {
    snapshots.push({ index: idx, stack: [...stack] });
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }

    if (ch === '"') {
      inStr = !inStr;
      continue;
    }

    if (inStr) continue;

    if (ch === "{") {
      stack.push("}");
      // Opening a nested container (depth > 1) is stable — we can close it immediately.
      if (stack.length > 1) record(i + 1);
    } else if (ch === "[") {
      stack.push("]");
      if (stack.length > 1) record(i + 1);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      // Closing a nested container: if we're still inside the root, record.
      if (stack.length >= 1) record(i + 1);
    } else if (ch === ",") {
      // After a comma we've just finished a complete sibling value.
      if (stack.length >= 1) record(i + 1);
    }
  }

  return { snapshots, finalStack: stack, finalInStr: inStr };
}

/**
 * Build a candidate JSON string by:
 *   1. Taking `text.slice(0, cutIdx)`.
 *   2. Stripping any trailing partial token that would prevent parsing
 *      (e.g. a dangling comma added by the cut itself).
 *   3. Appending closers from `openStack` (LIFO).
 */
function buildCandidate(text: string, cutIdx: number, openStack: string[]): string {
  let candidate = text.slice(0, cutIdx);
  // Strip a trailing comma that the cut left exposed (e.g. cut after ",").
  // repairJson would fix this too, but let's be precise.
  candidate = candidate.replace(/,\s*$/, "");
  for (let i = openStack.length - 1; i >= 0; i--) {
    candidate += openStack[i]!;
  }
  return candidate;
}

/**
 * Attempt JSON.parse; return the value or null on failure.
 */
function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Return `v` if it is a non-null, non-array object; otherwise null.
 */
function asObject(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

/**
 * Strip markdown code fences and locate the first `{` in a buffer.
 *
 * Handles:
 *   - ` ```json\n...\n``` ` fences (with or without language tag)
 *   - Leading prose before the first `{` (e.g. "Here is the result: {...}")
 *
 * Returns the preprocessed string ready for bracket-walking, or the original
 * trimmed string if no transformation applies.
 */
function stripFencesAndProse(text: string): string {
  // Strip leading ``` (with optional language tag) and trailing ```
  // Covers both complete (``` ... ```) and partial mid-stream (``` ... no closing)
  const fenced = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");

  // Find the first `{` — if prose precedes it, slice from there
  const braceIdx = fenced.indexOf("{");
  if (braceIdx < 0) return fenced; // no object found; let downstream handle it
  if (braceIdx === 0) return fenced; // already starts with `{`
  return fenced.slice(braceIdx);
}

/**
 * Parse a (possibly incomplete) JSON object prefix, returning a best-effort
 * `Record<string, unknown>`.
 *
 * - Complete object → full parse.
 * - Truncated mid-value → stable fields returned; dangling key/value dropped.
 * - Non-object / unparseable → `{}`.
 * - Markdown code fences and leading prose are stripped before parsing.
 */
export function parsePartial(buf: string): Record<string, unknown> {
  const trimmed = buf.trim();

  if (trimmed.length === 0) return {};

  // Preprocess: strip markdown fences and leading prose so the bracket walker
  // always sees a `{`-headed string.
  const preprocessed = stripFencesAndProse(trimmed);

  // Fast path: already valid JSON
  const quick = tryParse(preprocessed);
  if (quick !== null) {
    return asObject(quick) ?? {};
  }

  // Non-object head after preprocessing: try repairJson and return if object
  if (!preprocessed.startsWith("{")) {
    const repaired = tryParse(repairJson(preprocessed));
    return asObject(repaired) ?? {};
  }

  // Walk the buffer to collect stable-cut snapshots
  const { snapshots, finalStack, finalInStr } = walkBuffer(preprocessed);

  // --- Tier 1: Try stable cuts from latest to earliest ---
  // Iterating in reverse gives us the maximum parsed content. The latest cut
  // almost always parses on the first attempt; the walk-back only matters when
  // the tail is unparseable. Bound it to MAX_WALKBACK so a pathological buffer
  // (O(N) snapshots re-parsed per delta → O(N²)) cannot blow up — deeper cuts
  // are recovered on the next delta once more structure arrives, and Tier 2/3
  // below still cover the whole buffer.
  const lowerBound = Math.max(0, snapshots.length - MAX_WALKBACK);
  for (let i = snapshots.length - 1; i >= lowerBound; i--) {
    const snap = snapshots[i]!;
    const candidate = buildCandidate(preprocessed, snap.index, snap.stack);
    const parsed = tryParse(candidate);
    if (parsed !== null) {
      const obj = asObject(parsed);
      if (obj !== null) return obj;
    }
  }

  // --- Tier 2: Full-buffer close (close open string + open brackets) ---
  // This can succeed when the buffer ends cleanly between values, e.g. after a
  // complete number or boolean where no stable cut was recorded (unlikely but safe).
  {
    let full = preprocessed;
    if (finalInStr) full += '"';
    for (let j = finalStack.length - 1; j >= 0; j--) {
      full += finalStack[j]!;
    }
    const parsed = tryParse(full);
    if (parsed !== null) {
      const obj = asObject(parsed);
      if (obj !== null) return obj;
    }
  }

  // --- Tier 3: repairJson fallback on full preprocessed buffer ---
  const repairedFull = tryParse(repairJson(preprocessed));
  if (repairedFull !== null) {
    const obj = asObject(repairedFull);
    if (obj !== null) return obj;
  }

  return {};
}
