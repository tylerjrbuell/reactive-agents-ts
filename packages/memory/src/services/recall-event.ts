import type { DailyLogEntry, ProceduralEntry, SemanticEntry } from "../types.js";

/** Max items carried by one MemoryRecalled event. */
export const MEMORY_RECALLED_MAX_ITEMS = 20;
/** Max characters of an item summary in a MemoryRecalled event. */
export const MEMORY_RECALLED_MAX_SUMMARY = 160;

/** One recalled item, shaped like core's `MemoryRecalled.items` element. */
export interface RecalledItem {
  readonly id: string;
  readonly tier: string;
  readonly summary: string;
  readonly score?: number;
  readonly importance?: number;
}

/** The `MemoryRecalled` event shape published by the memory layer. */
export interface MemoryRecalledEvent {
  readonly _tag: "MemoryRecalled";
  readonly taskId: string;
  readonly agentId?: string;
  readonly tier: string;
  readonly items: readonly RecalledItem[];
  readonly query?: string;
}

const clip = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MEMORY_RECALLED_MAX_SUMMARY
    ? flat
    : `${flat.slice(0, MEMORY_RECALLED_MAX_SUMMARY - 1)}…`;
};

/**
 * Build one `MemoryRecalled` event per non-empty tier recalled at bootstrap.
 * Empty tiers yield no event. Items are capped and summaries truncated.
 */
export const buildBootstrapRecallEvents = (input: {
  readonly taskId: string;
  readonly agentId: string;
  readonly semantic: readonly SemanticEntry[];
  readonly episodes: readonly DailyLogEntry[];
  readonly workflows: readonly ProceduralEntry[];
}): MemoryRecalledEvent[] => {
  const { taskId, agentId } = input;
  const events: MemoryRecalledEvent[] = [];
  const push = (tier: string, items: readonly RecalledItem[]): void => {
    if (items.length === 0) return;
    events.push({
      _tag: "MemoryRecalled",
      taskId,
      agentId,
      tier,
      items: items.slice(0, MEMORY_RECALLED_MAX_ITEMS),
    });
  };
  push(
    "semantic",
    input.semantic.map((e) => ({
      id: e.id,
      tier: "semantic",
      summary: clip(e.summary || e.content),
      importance: e.importance,
    })),
  );
  push(
    "episodic",
    input.episodes.map((e) => ({
      id: e.id,
      tier: "episodic",
      summary: clip(e.content),
    })),
  );
  push(
    "procedural",
    input.workflows.map((e) => ({
      id: e.id,
      tier: "procedural",
      summary: clip(e.description || e.name),
      score: e.successRate,
    })),
  );
  return events;
};
