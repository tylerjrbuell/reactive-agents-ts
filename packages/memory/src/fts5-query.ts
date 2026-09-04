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
 */
export function toFts5Query(raw: string, maxTerms = 10, minTermLength = 4): string {
  return raw
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => w.length >= minTermLength)
    .slice(0, maxTerms)
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(" OR ");
}
