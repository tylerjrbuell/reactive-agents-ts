import { statSync } from "node:fs";
import { join } from "node:path";

/**
 * Relative paths (from repo / server cwd) checked for `withSkills({ paths })` hints in the Lab UI.
 */
export const SKILL_DIRECTORY_CANDIDATES = [
  ".claude/skills",
  ".agents/skills",
  "skills",
  /** Desk app skills when the server cwd is the monorepo root */
  "apps/cortex/.agents/skills",
] as const;

/** Returns candidate relative paths that exist as directories under `cwd`. */
export function discoverSkillDirectoryPaths(cwd: string = process.cwd()): string[] {
  const out: string[] = [];
  for (const rel of SKILL_DIRECTORY_CANDIDATES) {
    const abs = join(cwd, rel);
    try {
      if (statSync(abs).isDirectory()) out.push(rel);
    } catch {
      /* not found or not accessible */
    }
  }
  return out;
}
