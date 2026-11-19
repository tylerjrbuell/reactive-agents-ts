/**
 * Pure builders for the `PATCH /api/chat/sessions/:id/config` bodies behind the
 * /provider, /model, /skills and /docs slash commands. Kept free of the DOM so
 * the merge rules are unit-testable.
 */

export type SkillsConfig = { paths: string[]; activate?: string[]; global?: boolean };
export type DocumentConfig = { source: string; content?: string };

/** A skill the session's agent can load (`GET /api/skills/session/:id`, framework discovery). */
export interface DiscoveredSkill {
  readonly name: string;
  readonly description: string;
  /** Which scan root it came from. */
  readonly source?: "agent" | "workspace" | "configured" | "claude" | "global";
  /** Absolute scan directory (e.g. `<workspace>/.agents/skills`). */
  readonly root?: string;
}

/** Names the session always loads (bypassing task-relevance auto-activation). */
export const pinnedSkills = (cfg: Record<string, unknown>): readonly string[] => {
  const skills = cfg.skills as Partial<SkillsConfig> | undefined;
  return skills?.activate ?? [];
};

/**
 * Pin or unpin a skill for every turn of the session. A pin is the skill's NAME: the
 * chat agent discovers its workspace skills itself, so no scan root is written
 * (other skills settings are kept as they are).
 */
export function toggleSkillPatch(cfg: Record<string, unknown>, skill: Pick<DiscoveredSkill, "name">): { skills: SkillsConfig } {
  const current = (cfg.skills as Partial<SkillsConfig> | undefined) ?? {};
  const pinned = new Set(current.activate ?? []);
  if (pinned.has(skill.name)) pinned.delete(skill.name);
  else pinned.add(skill.name);
  return {
    skills: {
      paths: [...(current.paths ?? [])],
      ...(pinned.size > 0 ? { activate: [...pinned] } : {}),
      ...(current.global === true ? { global: true } : {}),
    },
  };
}

/** Pin several skills at once: `toggleSkillPatch` folded over `names`, so each name is toggled once in order. */
export function pinSkillsPatch(cfg: Record<string, unknown>, names: readonly string[]): { skills: SkillsConfig } {
  let next: Record<string, unknown> = cfg;
  for (const name of names) next = { ...next, ...toggleSkillPatch(next, { name }) };
  return { skills: next.skills as SkillsConfig };
}

export const documentsOf =(cfg: Record<string, unknown>): readonly DocumentConfig[] =>
  Array.isArray(cfg.documents) ? (cfg.documents as DocumentConfig[]) : [];

/** Add a document source (path or URL) once; the agent re-ingests it on the next turn. */
export function addDocumentPatch(cfg: Record<string, unknown>, source: string): { documents: DocumentConfig[] } | null {
  const s = source.trim();
  if (s === "") return null;
  const docs = documentsOf(cfg);
  if (docs.some((d) => d.source === s)) return null;
  return { documents: [...docs, { source: s }] };
}

export const removeDocumentPatch = (cfg: Record<string, unknown>, source: string): { documents: DocumentConfig[] } => ({
  documents: documentsOf(cfg).filter((d) => d.source !== source),
});
