/**
 * SkillsContext — one run's skills, as the kernel receives them.
 *
 * Skills spec step 4
 * (wiki/Architecture/Design-Specs/2026-11-06-skills-and-extension-model.md §4-§5).
 * The runtime fills this once per run on `KernelInput.skillsContext`; the
 * kernel seeds it onto `KernelState.skillsContext` (runner.ts).
 *
 * - `catalogXml` / `activatedXml` render in the system prompt's skills section
 *   (assembly/stages/system-prompt.ts). Both are frozen for the run.
 * - `skills` is what `activate-skill` can load. When it holds at least one
 *   skill, the kernel offers `activate-skill` on the tool surface and executes
 *   it inline (act/skill-activation.ts). When it is absent or empty, the run is
 *   byte-identical to a run without skills support.
 * - `pinned` names skills whose bodies are already in the system prompt
 *   (`activatedXml`); `activate-skill` answers "already loaded" for them.
 */
import type { ResolvedSkills } from "@reactive-agents/tools";

export interface SkillsContext {
  /** The `<available_skills>` catalog listing (system prompt). */
  readonly catalogXml?: string;
  /** Full `<skill_content>` blocks of skills pinned before turn 1 (system prompt). */
  readonly activatedXml?: string;
  /** Name to resolved skill: everything `activate-skill` may load this run. */
  readonly skills?: ResolvedSkills;
  /** Names already in the system prompt via `activatedXml`. */
  readonly pinned?: readonly string[];
}

/**
 * True when the run has at least one skill `activate-skill` can load. The one
 * predicate for offering the tool (tool-capabilities.ts), intercepting the call
 * (act.ts) and choosing the skills header (system-prompt.ts).
 */
export function hasActivatableSkills(ctx: SkillsContext | undefined): boolean {
  return (ctx?.skills?.size ?? 0) > 0;
}
