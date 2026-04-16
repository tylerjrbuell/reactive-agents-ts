/**
 * Lightweight literal-mention heuristic for required-tool detection.
 * Used when classifierReliability is "low" — skips the LLM classifier call.
 *
 * Matches tool names (with hyphens treated as optional separators) as
 * whole-word boundaries in the task text. Case-insensitive.
 */
export function literalMentionRequired(
  taskText: string,
  availableToolNames: readonly string[],
): readonly string[] {
  if (!taskText || availableToolNames.length === 0) return [];
  const lower = taskText.toLowerCase();
  return availableToolNames.filter((name) => {
    // Try exact match first: "web-search" or "web search" adjacent (hyphen as optional separator).
    // Use word boundaries around the whole tool name.
    const adjacentPattern = name.replace(/-/g, "[\\s-]?");
    const adjacentRe = new RegExp(`\\b${adjacentPattern}\\b`, "i");
    if (adjacentRe.test(lower)) return true;

    // Fallback: all hyphen-separated segments appear anywhere as whole words.
    // Handles "spawn a sub-agent" matching "spawn-agent" — "spawn" and "agent"
    // both appear as word-boundary tokens in the text.
    const segments = name.split("-");
    if (segments.length > 1) {
      return segments.every((seg) => new RegExp(`\\b${seg}\\b`, "i").test(lower));
    }
    return false;
  });
}
