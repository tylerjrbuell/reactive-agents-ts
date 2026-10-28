/** Mirrors `COMPACTED_USER_MARKER` in server/db/chat-queries.ts: the stand-in user row in front of a compaction summary. */
export const COMPACTED_USER_MARKER = "[Earlier conversation compacted]";

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
