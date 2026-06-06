// apps/advocate/src/ingest/score.ts
import type { CommunityThread } from "./types.js";

/**
 * Relevance score for ranking gathered threads. Combines:
 *  - term matches (title weighted 2×, snippet 1×) — the dominant signal,
 *  - recency (linear decay over ~30 days),
 *  - engagement (log of points + comments).
 */
export const scoreThread = (t: CommunityThread, terms: readonly string[]): number => {
  const title = t.title.toLowerCase();
  const snippet = (t.snippet ?? "").toLowerCase();
  const termScore = terms.reduce((acc, term) => {
    const w = term.toLowerCase();
    if (w.length === 0) return acc;
    return acc + (title.includes(w) ? 2 : 0) + (snippet.includes(w) ? 1 : 0);
  }, 0);
  const ageHours = (Date.now() - Date.parse(t.createdAt)) / 3_600_000;
  const recency = Number.isFinite(ageHours) ? Math.max(0, 1 - ageHours / (24 * 30)) : 0;
  const engagement = Math.log1p((t.points ?? 0) + (t.numComments ?? 0));
  return termScore * 10 + recency * 5 + engagement;
};
