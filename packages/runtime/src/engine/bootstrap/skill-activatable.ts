/**
 * The skills `activate-skill` may load this run (skills spec step 4,
 * wiki/Architecture/Design-Specs/2026-11-06-skills-and-extension-model.md §4-§5).
 *
 * `skill-resolve.ts` builds the entries once per run from the resolver's
 * `activatable` map; `skill-postprocess.ts` stores them on `ctx.metadata` as
 * plain data; `reasoning-think.ts` turns the metadata into the kernel's
 * `SkillsContext` with {@link skillsContextFromMetadata}.
 *
 * Every catalog skill is activatable. A filesystem skill carries its directory
 * (`activate-skill`'s `file` reads are confined to it); a learned or promoted
 * skill from the skill store has no directory, so its body loads and a `file`
 * read is refused.
 */
import type { SkillsContext } from "@reactive-agents/reasoning";
import type { ResolvedSkill } from "@reactive-agents/tools";

/** One activatable skill as it rides `ctx.metadata` (plain data, no `Map`). */
export interface ActivatableSkillEntry extends ResolvedSkill {
  readonly name: string;
}

/** `ctx.metadata` key holding the run's {@link ActivatableSkillEntry} list. */
export const ACTIVATABLE_SKILLS_KEY = "activatableSkills";
/** `ctx.metadata` key holding the names already rendered in `activatedSkillsXml`. */
export const PINNED_SKILLS_KEY = "pinnedSkillNames";

/** `dir` is optional (learned skills have none) but never an empty string. */
const isEntry = (v: unknown): v is ActivatableSkillEntry => {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e["name"] === "string" &&
    typeof e["body"] === "string" &&
    (e["dir"] === undefined || (typeof e["dir"] === "string" && e["dir"] !== "")) &&
    typeof e["sha256"] === "string"
  );
};

const trimmed = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

/**
 * The kernel's `SkillsContext` from `ctx.metadata`; `undefined` when the run
 * has no skills. `skills` is set only when at least one skill is activatable,
 * so a run without one keeps the exact tool surface it had before.
 */
export const skillsContextFromMetadata = (
  metadata: Readonly<Record<string, unknown>> | undefined,
): SkillsContext | undefined => {
  const catalogXml = trimmed(metadata?.["skillCatalogXml"]);
  const activatedXml = trimmed(metadata?.["activatedSkillsXml"]);
  if (catalogXml === undefined && activatedXml === undefined) return undefined;

  const rawEntries = metadata?.[ACTIVATABLE_SKILLS_KEY];
  const skills: Map<string, ResolvedSkill> = new Map();
  if (Array.isArray(rawEntries)) {
    for (const e of rawEntries) {
      if (!isEntry(e) || skills.has(e.name)) continue;
      const { name, ...skill } = e;
      skills.set(name, skill);
    }
  }
  const rawPinned = metadata?.[PINNED_SKILLS_KEY];
  const pinned = Array.isArray(rawPinned)
    ? rawPinned.filter((n): n is string => typeof n === "string" && n.length > 0)
    : [];

  return {
    catalogXml,
    activatedXml,
    ...(skills.size > 0 ? { skills } : {}),
    ...(skills.size > 0 && pinned.length > 0 ? { pinned } : {}),
  };
};
