/**
 * Path and SQL-LIKE hardening helpers for the memory package.
 *
 * Kept dependency-free so every memory module (config resolver, database,
 * markdown file system, search fallbacks) shares one implementation.
 */

/** Directory mode for memory dirs the package creates (owner-only). */
export const MEMORY_DIR_MODE = 0o700;
/** File mode for memory files the package creates (owner-only). */
export const MEMORY_FILE_MODE = 0o600;

/**
 * Contain an agent id to a single inert path segment so it can never escape
 * the base directory it is joined into (`../x`, absolute paths, backslashes).
 * Percent-encodes separators; `.`, `..` and empty are neutralised. Ordinary
 * ids (letters, digits, `-`, `_`) pass through unchanged.
 *
 * @param agentId - Untrusted agent id.
 * @returns A single path segment safe to join under a base directory.
 */
export const safeAgentPathSegment = (agentId: string): string => {
  const seg = encodeURIComponent(agentId);
  if (seg === "") return "_";
  if (seg === "." || seg === "..") return seg.replace(/\./g, "%2E");
  return seg;
};

/**
 * Escape SQL LIKE wildcards (`%`, `_`) and the escape char itself so user text
 * matches literally. Pair with `ESCAPE '\'` in the query.
 *
 * @param text - Raw user text.
 * @returns Text safe to embed in a LIKE pattern.
 */
export const escapeLike = (text: string): string =>
  text.replace(/[\\%_]/g, (c) => `\\${c}`);
