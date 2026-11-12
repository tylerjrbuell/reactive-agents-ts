/**
 * The Context view's three sources of knowledge for a run: the skills it had active (why,
 * from ui-core's `RunSkillsView`), the memories it RECALLED into its context (from the
 * run's `MemoryRecalled` events, ui-core `foldRecalledMemories`) and the memories it wrote
 * (the Memory studio's `GET /api/memory/:agentId?runId=`). Pure: `ContextSources.svelte`
 * renders it.
 *
 * A run that reported no `MemoryRecalled` event (memory off, an older run, or a run that
 * recalled nothing) keeps the `RECALL_NOT_REPORTED` note rather than a faked empty list.
 */
import {
  foldRecalledMemories,
  memoryRecalledOf,
  type MemoryRecalledLike,
  type RecalledMemoryView,
  type RunSkillsView,
} from "@reactive-agents/ui-core";
import { skillChips, skillsAvailableNote, type SkillChip } from "./skill-row.js";
import { memoryStudioHref, type MemoryListing } from "./memory-studio.js";

/** Shown when the run reported no recall event, in place of a recalled-memory list. */
export const RECALL_NOT_REPORTED = "This run reported no recalled memories (memory off, or nothing was recalled), so only what it wrote is listed.";

/** What a run recalled: `reported` is false until at least one `MemoryRecalled` event is seen. */
export interface RunRecall {
  readonly reported: boolean;
  readonly items: readonly RecalledMemoryView[];
}

/** Nothing reported. */
export const NO_RECALL: RunRecall = { reported: false, items: [] };

/** A run's recall from live messages (`{ type, payload }`, payload = the AgentEvent). */
export function runRecallFromLive(events: readonly { readonly type: string; readonly payload: unknown }[]): RunRecall {
  const recalled: MemoryRecalledLike[] = [];
  for (const e of events) {
    if (e.type !== "MemoryRecalled") continue;
    const r = memoryRecalledOf(e.payload);
    if (r) recalled.push(r);
  }
  return recalled.length === 0 ? NO_RECALL : { reported: true, items: foldRecalledMemories(recalled) };
}

/** A recalled memory, worded for a list; `href` opens it in the Memory studio when the tier has a studio layer. */
export interface RecalledRow {
  readonly id: string;
  readonly tier: string;
  readonly title: string;
  /** `relevance 0.82 · importance 0.60`, parts the framework did not report left out. */
  readonly detail: string;
  /** What query surfaced it; absent for a bootstrap recall. */
  readonly query?: string;
  readonly href?: string;
}

const STUDIO_TIERS: ReadonlySet<string> = new Set(["semantic", "procedural", "episodic"]);

/** The recalled memories as list rows, linked to the agent's Memory studio when `agentId` is known. */
export function recalledRows(recall: RunRecall, agentId: string | undefined): RecalledRow[] {
  return recall.items.map((m): RecalledRow => {
    const parts: string[] = [];
    if (m.score !== undefined) parts.push(`relevance ${m.score.toFixed(2)}`);
    if (m.importance !== undefined) parts.push(`importance ${m.importance.toFixed(2)}`);
    return {
      id: m.id,
      tier: m.tier,
      title: m.summary ? clip(m.summary, 140) : "(no summary)",
      detail: parts.join(" · "),
      ...(m.query !== undefined ? { query: m.query } : {}),
      ...(agentId && STUDIO_TIERS.has(m.tier) ? { href: memoryStudioHref(agentId, undefined, m.id) } : {}),
    };
  });
}

/** Where a skill's source lives. */
export const SKILLS_HREF = "/lab#skills";

/** One memory this run wrote. */
export interface WrittenMemory {
  readonly id: string;
  readonly kind: "fact" | "workflow" | "log";
  readonly title: string;
  readonly detail: string;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Everything a run wrote, facts first, then workflows, then the log. */
export function writtenMemories(listing: MemoryListing | null): WrittenMemory[] {
  if (!listing?.available) return [];
  return [
    ...listing.semantic.map((m): WrittenMemory => ({ id: m.id, kind: "fact", title: clip(m.summary || m.content, 140), detail: `importance ${m.importance.toFixed(2)}` })),
    ...listing.procedural.map((m): WrittenMemory => ({ id: m.id, kind: "workflow", title: m.name, detail: `${Math.round(m.successRate * 100)}% success` })),
    ...listing.episodic.map((m): WrittenMemory => ({ id: m.id, kind: "log", title: clip(m.content, 140), detail: m.eventType })),
  ];
}

/** The sections of the Context view, ready to render. */
export interface ContextSourcesView {
  readonly skills: readonly SkillChip[];
  readonly skillsMore: string | null;
  readonly memories: readonly WrittenMemory[];
  /** Memories the run recalled into its context; empty when none were reported. */
  readonly recalled: readonly RecalledRow[];
  /** True when the run reported at least one `MemoryRecalled` event: the "not reported" note is then dropped. */
  readonly recallReported: boolean;
  /** One line above the lists: `2 skills used · 4 memories recalled · 3 memories written`. */
  readonly summary: string;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Combine a run's skills, recalled memories and written memories. */
export function contextSourcesOf(
  skills: RunSkillsView | undefined,
  listing: MemoryListing | null,
  recall: RunRecall = NO_RECALL,
  agentId?: string,
): ContextSourcesView {
  const chips = skillChips(skills);
  const memories = writtenMemories(listing);
  const recalled = recalledRows(recall, agentId);
  const recallPart = recall.reported ? ` · ${plural(recalled.length, "memory", "memories")} recalled` : "";
  return {
    skills: chips,
    skillsMore: skillsAvailableNote(skills),
    memories,
    recalled,
    recallReported: recall.reported,
    summary: `${plural(chips.length, "skill")} used${recallPart} · ${plural(memories.length, "memory", "memories")} written`,
  };
}
