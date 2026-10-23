/**
 * decide/text-similarity.ts — normalized Levenshtein similarity.
 *
 * Pure lexical utility (no dependencies). Moved verbatim from `arbitrator.ts`
 * (GH #220 / quality program Task 7); `normalizedLevenshtein` is still
 * re-exported from `arbitrator.ts` (imported by runner-helpers/flail-signature
 * and the lexical termination evaluators).
 */

// ── Levenshtein Utility ──────────────────────────────────────────────────────

/** Normalized Levenshtein similarity (0-1, 1 = identical). No external dependencies. */
export function normalizedLevenshtein(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) { matrix[i]![j] = j; continue; }
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return 1 - matrix[a.length]![b.length]! / maxLen;
}
