/** Mirrors `COMPACTED_USER_MARKER` in server/db/chat-queries.ts: the stand-in user row in front of a compaction summary. */
export const COMPACTED_USER_MARKER = "[Earlier conversation compacted]";

/** Mirrors `COMPACTION_SECTIONS` in server/services/compaction-summary.ts: the summary's section names, in order. */
export const COMPACTION_SECTIONS = [
  "Goal",
  "Decisions",
  "Facts & identifiers",
  "Files & artifacts",
  "Open questions",
  "Next steps",
] as const;

/** Mirrors `UNSTRUCTURED_SUMMARY_HEADING` (without `## `): the server's wrapper for a summary it could not match. */
const UNSTRUCTURED_HEADING = "Summary (unstructured)";

/** One `## Heading` block of a compaction summary. `heading` is "" for text before the first heading. */
export type CompactionSection = { readonly heading: string; readonly body: string };

/**
 * Mirrors `normalizeSectionHeading` in server/services/compaction-summary.ts: trimmed,
 * whitespace collapsed, lower case, trailing colons and parentheticals removed.
 */
export function normalizeSectionHeading(heading: string): string {
  let s = heading.trim().replace(/\s+/g, " ");
  for (;;) {
    const next = s.replace(/\s*:\s*$/, "").replace(/\s*\([^()]*\)\s*$/, "");
    if (next === s) break;
    s = next;
  }
  return s.toLowerCase();
}

const CANONICAL = new Map<string, string>(COMPACTION_SECTIONS.map((s) => [normalizeSectionHeading(s), s]));

/**
 * Split a compaction summary into its `## Heading` sections (the server asks for
 * Goal / Decisions / Facts & identifiers / Files & artifacts / Open questions /
 * Next steps). A heading that normalizes to one of those names shows as that name,
 * so `## Facts & identifiers (names, IDs)` reads `Facts & identifiers`. An empty
 * `Summary (unstructured)` wrapper is dropped. `null` when there is no `##` heading
 * at all, so the caller renders the plain text. `###` lines and lines inside code
 * fences are body text.
 */
export function parseCompactionSections(text: string): CompactionSection[] | null {
  const sections: { heading: string; lines: string[] }[] = [];
  let current: { heading: string; lines: string[] } = { heading: "", lines: [] };
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence ? /^##\s+(.+?)\s*$/.exec(line) : null;
    if (m) {
      sections.push(current);
      current = { heading: CANONICAL.get(normalizeSectionHeading(m[1]!)) ?? m[1]!, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  if (!sections.some((s) => s.heading !== "")) return null;
  const out = sections
    .map((s) => ({ heading: s.heading, body: s.lines.join("\n").trim() }))
    .filter((s) => (s.heading !== "" && s.heading !== UNSTRUCTURED_HEADING) || s.body !== "");
  return out.length > 0 ? out : null;
}

/** Indices of compaction marker rows and of the summary row that follows each. */
export function compactionRows(turns: readonly { role: string; content: string }[]): { markers: ReadonlySet<number>; summaries: ReadonlySet<number> } {
  const markers = new Set<number>();
  const summaries = new Set<number>();
  turns.forEach((t, i) => {
    if (t.role === "user" && t.content === COMPACTED_USER_MARKER) {
      markers.add(i);
      if (turns[i + 1]?.role === "assistant") summaries.add(i + 1);
    }
  });
  return { markers, summaries };
}
