/**
 * Shared JSON parsing helper for SQLite-backed memory services.
 *
 * bun:sqlite TEXT columns (tags, metadata, config, messages, tool_args, etc.)
 * are trusted to contain JSON written by this package, but a single corrupt
 * or hand-edited row must not crash an entire query. Every `JSON.parse` call
 * on a DB column in `packages/memory/src/services/**` and `search.ts` should
 * go through this helper so a malformed row degrades to a fallback value
 * instead of throwing a SyntaxError that becomes an unrecoverable Effect
 * defect.
 */
export function safeJsonParse<T>(
  raw: string | null | undefined,
  fallback: T,
): T {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
