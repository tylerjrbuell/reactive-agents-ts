/**
 * The Context view's two sources of knowledge for a run: the skills it had active (why,
 * from ui-core's `RunSkillsView`) and the memories it wrote (the Memory studio's
 * `GET /api/memory/:agentId?runId=`). Pure: `ContextSources.svelte` renders it.
 *
 * Memory the agent *recalled* is not here: the framework publishes no recall event
 * (`MemoryBootstrapped` / `MemoryFlushed` carry only a tier and an agent id), so Cortex
 * says so rather than guess. `RECALL_NOT_REPORTED` is the wording.
 */
import type { RunSkillsView } from "@reactive-agents/ui-core";
import { skillChips, skillsAvailableNote, type SkillChip } from "./skill-row.js";
import type { MemoryListing } from "./memory-studio.js";

/** Shown in place of a recalled-memory list. */
export const RECALL_NOT_REPORTED = "Which memories the agent recalled is not reported by the framework yet, so only what this run wrote is listed.";

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
  /** One line above the lists: `2 skills · 3 memories written`. */
  readonly summary: string;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Combine a run's skills and written memories. */
export function contextSourcesOf(skills: RunSkillsView | undefined, listing: MemoryListing | null): ContextSourcesView {
  const chips = skillChips(skills);
  const memories = writtenMemories(listing);
  return {
    skills: chips,
    skillsMore: skillsAvailableNote(skills),
    memories,
    summary: `${plural(chips.length, "skill")} used · ${plural(memories.length, "memory", "memories")} written`,
  };
}
