/**
 * Which memories a run RECALLED into its context, read from what the run
 * REPORTED: its `MemoryRecalled` events (one per non-empty tier at bootstrap,
 * plus any later search or tool recall). Never inferred from config or from what
 * the run wrote. Pure, framework-free: any chat or run UI can render the result.
 */

/** One recalled item as the `MemoryRecalled` event carries it. */
export interface RecalledItemLike {
  readonly id: string;
  readonly tier: string;
  /** Short summary, truncated by the producer. */
  readonly summary: string;
  /** Relevance from the recall query; absent when the tier does not rank. */
  readonly score?: number;
  /** Stored importance; absent when the tier does not track it. */
  readonly importance?: number;
}

/** The fields of a `MemoryRecalled` event this module reads. */
export interface MemoryRecalledLike {
  readonly tier: string;
  readonly items: readonly RecalledItemLike[];
  /** The recall query as text; absent for non-query recalls such as bootstrap. */
  readonly query?: string;
  readonly taskId?: string;
}

/** One memory the run recalled. */
export interface RecalledMemoryView {
  readonly id: string;
  readonly tier: string;
  readonly summary: string;
  readonly score?: number;
  readonly importance?: number;
  /** The query that surfaced it (first recall that did); absent for a bootstrap recall. */
  readonly query?: string;
}

/** Most recalled items kept per run (a run recalling more is capped, in rank order). */
export const MAX_RECALLED_MEMORIES = 100;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * Read a `MemoryRecalled` event payload (an unknown JSON value, e.g. a stored
 * live message) as {@link MemoryRecalledLike}; `undefined` when it is not one.
 * Items without a string `id` are dropped.
 */
export function memoryRecalledOf(payload: unknown): MemoryRecalledLike | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const p = payload as Record<string, unknown>;
  if (typeof p.tier !== "string" || !Array.isArray(p.items)) return undefined;
  const items: RecalledItemLike[] = [];
  for (const raw of p.items) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || r.id === "") continue;
    const score = num(r.score);
    const importance = num(r.importance);
    items.push({
      id: r.id,
      tier: typeof r.tier === "string" ? r.tier : p.tier,
      summary: typeof r.summary === "string" ? r.summary : "",
      ...(score !== undefined ? { score } : {}),
      ...(importance !== undefined ? { importance } : {}),
    });
  }
  return {
    tier: p.tier,
    items,
    ...(typeof p.query === "string" && p.query !== "" ? { query: p.query } : {}),
    ...(typeof p.taskId === "string" ? { taskId: p.taskId } : {}),
  };
}

/**
 * The memories a run recalled: every item of every `MemoryRecalled` event,
 * first sighting per tier + id wins (a later recall of the same item adds its
 * score only when the first reported none), in the order recalled, capped at
 * {@link MAX_RECALLED_MEMORIES}. `[]` when the run reported none.
 */
export function foldRecalledMemories(events: readonly MemoryRecalledLike[]): RecalledMemoryView[] {
  const seen = new Map<string, RecalledMemoryView>();
  for (const ev of events) {
    for (const item of ev.items) {
      const key = `${item.tier}\u0000${item.id}`;
      const prev = seen.get(key);
      if (prev) {
        if (prev.score === undefined && item.score !== undefined) seen.set(key, { ...prev, score: item.score });
        continue;
      }
      if (seen.size >= MAX_RECALLED_MEMORIES) continue;
      seen.set(key, {
        id: item.id,
        tier: item.tier,
        summary: item.summary,
        ...(item.score !== undefined ? { score: item.score } : {}),
        ...(item.importance !== undefined ? { importance: item.importance } : {}),
        ...(ev.query !== undefined ? { query: ev.query } : {}),
      });
    }
  }
  return [...seen.values()];
}
