/**
 * Fuzzy ranking of file paths for pickers (the composer's `@` menu). Pure.
 */

/** A ranked path and the character offsets that matched, for highlighting. */
export interface PathMatch {
  readonly path: string;
  readonly score: number;
  readonly indices: readonly number[];
}

const isBoundary = (s: string, i: number): boolean => i === 0 || "/-_. ".includes(s[i - 1]!);

/**
 * Subsequence match of `query` in `path` (case-insensitive) with bonuses for
 * a match in the base name, at word boundaries and in runs. Null when the
 * query characters do not all appear in order.
 */
export function scorePath(query: string, path: string): PathMatch | null {
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  const baseStart = path.lastIndexOf("/") + 1;
  if (q === "") return { path, score: -path.split("/").length * 10 - path.length / 100, indices: [] };
  // A contiguous hit in the base name beats a scattered one.
  const at = p.indexOf(q, baseStart);
  if (at >= 0) {
    return { path, score: 1000 + (isBoundary(p, at) ? 200 : 0) - (at - baseStart) - path.length / 100, indices: Array.from({ length: q.length }, (_, k) => at + k) };
  }
  const indices: number[] = [];
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    const i = p.indexOf(ch, from);
    if (i < 0) return null;
    score += 10;
    if (i === prev + 1) score += 15;
    if (isBoundary(p, i)) score += 12;
    if (i >= baseStart) score += 5;
    indices.push(i);
    prev = i;
    from = i + 1;
  }
  return { path, score: score - path.length / 100, indices };
}

/** The best `limit` paths for a query, best first; an empty query lists shallow short paths first. */
export function rankPaths(query: string, paths: readonly string[], limit = 50): readonly PathMatch[] {
  const hits: PathMatch[] = [];
  for (const path of paths) {
    const m = scorePath(query.trim(), path);
    if (m) hits.push(m);
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}
