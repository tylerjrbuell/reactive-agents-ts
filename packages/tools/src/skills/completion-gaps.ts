/**
 * Lightweight heuristic that checks whether the agent's tool usage covers the
 * key actions described in the task.  Works by:
 *  1. Detecting MCP namespaces referenced in the task (e.g. "signal", "github")
 *  2. Checking if at least one tool from each namespace was actually called
 *  3. Matching common action-verb patterns to tool categories
 *
 * Returns an array of human-readable gap descriptions (empty = all good).
 */
export function detectCompletionGaps(
  task: string,
  toolsUsed: ReadonlySet<string>,
  allToolSchemas: readonly { name: string }[],
  steps?: readonly { type: string; content: string; metadata?: Record<string, unknown> }[],
): string[] {
  const taskLower = task.toLowerCase();
  const gaps: string[] = [];

  // ── FC metadata supplement ────────────────────────────────────────────────
  // When native function calling is active, action steps carry metadata.toolCall
  // with structured { name, arguments } data. Supplement the caller-provided
  // toolsUsed set with any tool names found in step metadata so gap detection
  // works correctly for both the text-based and FC code paths.
  let effectiveToolsUsed = toolsUsed;
  if (steps) {
    const extraTools: string[] = [];
    for (const s of steps) {
      if (s.type === "action" && s.metadata?.toolCall) {
        const tc = s.metadata.toolCall as { name: string } | undefined;
        if (tc?.name && !toolsUsed.has(tc.name)) {
          extraTools.push(tc.name);
        }
      }
    }
    if (extraTools.length > 0) {
      effectiveToolsUsed = new Set([...toolsUsed, ...extraTools]);
    }
  }

  // ── Sub-agent delegation awareness ───────────────────────────────────────
  // If spawn-agent was used and its observation shows success for a namespace,
  // treat that namespace as satisfied — the sub-agent handled it.
  const delegatedNamespaces = new Set<string>();
  if (effectiveToolsUsed.has("spawn-agent") && steps) {
    for (const s of steps) {
      if (s.type !== "observation") continue;
      const content = s.content.toLowerCase();
      // Sub-agent success observations contain tool names or namespace references
      // e.g. "signal/send_message_to_user" or "github/list_commits"
      const nsMatches = content.matchAll(/(\w+)\/\w+/g);
      for (const m of nsMatches) {
        delegatedNamespaces.add(m[1]!.toLowerCase());
      }
      // Also detect explicit success indicators mentioning namespaces
      if (content.includes("success") || content.includes("sent") || content.includes("completed")) {
        // Extract namespace-like words from the observation
        for (const ns of allToolSchemas.map((s) => s.name.includes("/") ? s.name.split("/")[0]!.toLowerCase() : null).filter(Boolean)) {
          if (ns && content.includes(ns)) delegatedNamespaces.add(ns);
        }
      }
    }
  }

  // Collect ALL MCP namespaces from the full tool registry (not the filtered
  // adaptive subset) so that we catch references even when tools are hidden.
  const namespaces = new Set<string>();
  for (const s of allToolSchemas) {
    if (s.name.includes("/")) namespaces.add(s.name.split("/")[0]!.toLowerCase());
  }

  // For each namespace, check if the task references it AND no tool from it was used.
  // Use word-boundary matching to avoid false positives (e.g. "signal" in "signaling").
  for (const ns of namespaces) {
    // Word-boundary check: namespace must appear as a distinct word in the task,
    // not as a substring of another word or inside quoted content being forwarded.
    const nsRegex = new RegExp(`\\b${ns}\\b`, "i");
    const taskMentionsNs = nsRegex.test(taskLower);
    if (!taskMentionsNs) continue;

    // Skip if a sub-agent already handled this namespace
    if (delegatedNamespaces.has(ns)) continue;

    const usedFromNs = [...effectiveToolsUsed].some((t) => t.toLowerCase().startsWith(ns + "/"));
    if (!usedFromNs) {
      gaps.push(`Task mentions "${ns}" but no ${ns}/* tool was called — use the appropriate ${ns}/* tool`);
    }
  }

  // Common action-verb → tool-category heuristics for built-in tools.
  // Patterns are intentionally specific to avoid false positives:
  // - "search" alone is NOT included — it matches "rag search", "database search", etc.
  //   Only explicit web-search indicators ("search online", "web search", "look up", "google") count.
  const ACTION_TOOL_MAP: [RegExp, string, (used: ReadonlySet<string>) => boolean][] = [
    [/\b(search online|web search|look up|find online|google)\b/i, "web-search", (u) => u.has("web-search")],
    [/\b(write to|save to|create) (a )?file\b/i, "file-write", (u) => u.has("file-write")],
    [/\b(read|open|load) (a |the )?file\b/i, "file-read", (u) => u.has("file-read")],
  ];
  for (const [pattern, toolName, check] of ACTION_TOOL_MAP) {
    const match = taskLower.match(pattern);
    if (match && !check(effectiveToolsUsed)) {
      gaps.push(`Task asks to "${match[0]}" but ${toolName} was not called`);
    }
  }

  return gaps;
}
