/**
 * Pure builders for the `PATCH /api/chat/sessions/:id/config` bodies behind the
 * /provider, /model, /skills and /docs slash commands. Kept free of the DOM so
 * the merge rules are unit-testable.
 */

export type SkillsConfig = { paths: string[]; activate?: string[] };
export type DocumentConfig = { source: string; content?: string };

export interface DiscoveredSkill {
  readonly name: string;
  readonly description: string;
  /** Directory holding this skill's SKILL.md (POSIX). */
  readonly skillDir: string;
}

/** `withSkills({ paths })` scans a root whose children are skill folders, so a skill's root is its parent directory. */
export const skillRoot = (skillDir: string): string => {
  const i = skillDir.replace(/\/+$/, "").lastIndexOf("/");
  return i <= 0 ? "." : skillDir.slice(0, i);
};

/** Names the session always loads (bypassing task-relevance auto-activation). */
export const pinnedSkills = (cfg: Record<string, unknown>): readonly string[] => {
  const skills = cfg.skills as Partial<SkillsConfig> | undefined;
  return skills?.activate ?? [];
};

/** Pin or unpin a skill. Pinning also makes sure the skill's root is on the scan path. */
export function toggleSkillPatch(cfg: Record<string, unknown>, skill: DiscoveredSkill): { skills: SkillsConfig } {
  const current = (cfg.skills as Partial<SkillsConfig> | undefined) ?? {};
  const paths = [...(current.paths ?? [])];
  const pinned = new Set(current.activate ?? []);
  if (pinned.has(skill.name)) {
    pinned.delete(skill.name);
  } else {
    pinned.add(skill.name);
    const root = skillRoot(skill.skillDir);
    if (!paths.includes(root)) paths.push(root);
  }
  return { skills: { paths, ...(pinned.size > 0 ? { activate: [...pinned] } : {}) } };
}

export const documentsOf = (cfg: Record<string, unknown>): readonly DocumentConfig[] =>
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
