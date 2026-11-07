/**
 * The skills `activate-skill` may load this run (skills spec step 4,
 * wiki/Architecture/Design-Specs/2026-11-06-skills-and-extension-model.md §4-§5).
 *
 * `skill-resolve.ts` builds the entries once per run; `skill-postprocess.ts`
 * stores them on `ctx.metadata` as plain data; `reasoning-think.ts` turns the
 * metadata into the kernel's `SkillsContext` with {@link skillsContextFromMetadata}.
 *
 * Only skills with a directory on disk are activatable: `activate-skill`'s
 * `file` reads are confined to that directory, so a skill without one (learned
 * or promoted from the skill store) stays catalog-only. The resolver output
 * (`SkillRecord`) carries no directory, so the directory comes from the
 * discovery scan the resolver ran, repeated here with the same arguments.
 */
import { createHash } from "node:crypto";
import * as path from "node:path";
import type { SkillRecord } from "@reactive-agents/core";
import type { InstalledSkill } from "@reactive-agents/reactive-intelligence";
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

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * Pair each filesystem catalog skill with its discovered directory. Pure.
 *
 * A record is kept only when its source is `installed` and discovery found a
 * skill of the same name: a learned skill that won a name collision has a
 * body that is not the file on disk, so it gets no directory. `sha256` is of
 * the body, matching `run-started.config.skills.catalog[].sha256`.
 */
export const buildActivatableSkills = (
  catalog: readonly SkillRecord[],
  installed: readonly InstalledSkill[],
): readonly ActivatableSkillEntry[] => {
  const byName = new Map<string, InstalledSkill>();
  for (const s of installed) if (!byName.has(s.name)) byName.set(s.name, s);
  const out: ActivatableSkillEntry[] = [];
  for (const record of catalog) {
    if (record.source !== "installed") continue;
    const found = byName.get(record.name);
    if (found === undefined) continue;
    const body = record.instructions;
    const { scripts, references } = found.resources;
    out.push({
      name: record.name,
      body,
      dir: path.dirname(found.filePath),
      sha256: sha256(body),
      version: record.version,
      source: record.source,
      ...(scripts.length > 0 || references.length > 0
        ? { resources: { scripts: [...scripts], references: [...references] } }
        : {}),
    });
  }
  return out;
};

const isEntry = (v: unknown): v is ActivatableSkillEntry => {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e["name"] === "string" &&
    typeof e["body"] === "string" &&
    typeof e["dir"] === "string" &&
    e["dir"] !== "" &&
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
