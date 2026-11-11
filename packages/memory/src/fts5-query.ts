/**
 * Common English function words. They match nearly every row, so they add
 * noise to an OR-joined query and use up `maxTerms` slots meant for real
 * terms. Kept small on purpose: anything that could be a real search term
 * (e.g. "it", "go", "us") stays out of this list.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "do", "does", "for",
  "from", "had", "has", "have", "how", "i", "if", "in", "into", "is", "of",
  "on", "or", "our", "so", "than", "that", "the", "their", "then", "there",
  "these", "they", "this", "those", "to", "was", "we", "were", "what", "when",
  "where", "which", "who", "why", "will", "with", "you", "your",
]);

/**
 * Turn free text (model-provided search queries, or raw content being
 * auto-linked) into a safe SQLite FTS5 `MATCH` query string.
 *
 * FTS5's query syntax treats bare words specially — a hyphen, colon, or
 * other punctuation in an UNQUOTED term is parsed as query syntax (NOT,
 * column filter, etc.), not literal text. A word like "Effect-TS" fed
 * straight into `MATCH` throws `SQLiteError: no such column: TS` — this hit
 * live in three call sites (autoLinkText, searchSemantic, searchEpisodic)
 * independently, all with the same root cause: none of them quoted terms.
 *
 * Each word is quoted as an FTS5 string literal (embedded `"` doubled per
 * FTS5 escaping) so it is matched as literal text; words are OR-joined so
 * any one matching counts (ranking still favors the better matches via
 * BM25). Empty input (or input that is punctuation-only after stripping)
 * returns `""` — callers should treat that as "no query" rather than
 * passing it to MATCH.
 *
 * Short real terms are kept: the default `minTermLength` is 2, so "bun",
 * "ai" and "db" are searchable. Noise is removed by a stop-word list instead
 * of by length. When every term is a stop word (a query of just "the"), the
 * stop words are kept so the query still means something.
 */
export function toFts5Query(raw: string, maxTerms = 10, minTermLength = 2): string {
  const terms = raw
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => w.length >= minTermLength);
  const content = terms.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  return (content.length > 0 ? content : terms)
    .slice(0, maxTerms)
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(" OR ");
}
