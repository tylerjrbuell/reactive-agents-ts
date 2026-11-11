/**
 * Separator / case-variant tool-name resolution at the execute boundary.
 *
 * A census of 501 recorded runs (2026-11-10) found 19 calls to MCP tools
 * spelled with `_` instead of `/` (`umami_get_website_stats` for
 * `umami/get_website_stats`) and `web_search` for `web-search`, all failing as
 * unknown tools. Providers forbid `/` in function names, so the `_` form is
 * often the only one a model can emit. These names differ from a real tool
 * only in separators and case, so the call has one obvious target.
 *
 * ToolService.execute already reaches the right tool for these names (the
 * registry heals near-misses) and annotates the result with the note below.
 * Those census calls failed earlier, in a caller that checks names against the
 * tool list before calling execute (the kernel's available-tool guard).
 * `resolveToolName` is the pure, ambiguity-safe check such a caller can use.
 *
 * This is the package's ONLY separator / case matcher (2026-11-10). The
 * registry heal (`healToolName`), the text parser and native-FC name healing
 * all reach it, so `a_b` with both `a-b` and `a/b` registered resolves to
 * neither everywhere instead of to whichever name a rewrite tried first.
 */

/**
 * Lowercase word tokens of a tool name. Any non-alphanumeric run is a
 * separator and camelCase humps split (`fileRead` → `file`,`read`).
 */
export function tokenizeToolName(name: string): readonly string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/** Tokens joined by `-`: equal keys mean names differ only in separators and case. */
const nameKey = (name: string): string => tokenizeToolName(name).join("-");

/**
 * Every available name equal to `requested` after the separator / case
 * collapse (verbatim matches included). Callers that need to tell "no
 * variant" from "ambiguous variant" use this; most use {@link resolveToolName}.
 */
export function toolNameVariants(
  requested: string,
  availableNames: Iterable<string>,
): readonly string[] {
  const key = nameKey(requested);
  if (key.length === 0) return [];
  return [...availableNames].filter((n) => nameKey(n) === key);
}

/**
 * Resolve a requested tool name against the available names.
 *
 * Returns `requested` when it is available verbatim. Otherwise returns the
 * ONE available name equal to it after lowercasing, splitting camelCase and
 * treating any run of non-alphanumerics (`_` `-` `/` `.` `:`) as the same
 * separator. Returns `undefined` when nothing matches or more than one name
 * matches (ambiguous: never guess).
 *
 * Pure. No edit distance and no semantic guessing: `web_search` resolves to
 * `web-search`, `websearch` does not.
 *
 * @example
 * ```ts
 * resolveToolName("umami_get_website_stats", ["umami/get_website_stats"]);
 * // "umami/get_website_stats"
 * resolveToolName("web_search", ["web-search", "http-get"]); // "web-search"
 * resolveToolName("a_b", ["a-b", "a/b"]); // undefined (ambiguous)
 * ```
 */
export function resolveToolName(
  requested: string,
  availableNames: Iterable<string>,
): string | undefined {
  const names = [...availableNames];
  if (names.includes(requested)) return requested;
  const matches = toolNameVariants(requested, names);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * The note added to a result when the call ran under a corrected name, e.g.
 * `(called as umami_get_website_stats; ran umami/get_website_stats)`.
 */
export const toolNameCorrectionNote = (calledAs: string, ran: string): string =>
  `(called as ${calledAs}; ran ${ran})`;

/**
 * Attach the correction note to a handler result so the model sees which
 * tool really ran. A string result gets the note as a trailing line; a plain
 * object gets a `toolNameCorrection` field (its other keys are unchanged).
 * Any other value (array, number, null) is returned unchanged: its shape is
 * the tool's contract, and the caller still has `ToolOutput.metadata`.
 */
export function annotateToolNameCorrection(
  result: unknown,
  calledAs: string,
  ran: string,
): unknown {
  const note = toolNameCorrectionNote(calledAs, ran);
  if (typeof result === "string") return `${result}\n${note}`;
  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), toolNameCorrection: note };
  }
  return result;
}
