import { statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Relative paths (from each **scan base**) checked for open-skill packages:
 * each immediate subfolder may contain `SKILL.md` (agentskills.io-style YAML + markdown).
 *
 * **Canonical layout (Open Agent Skills):** `.agents/skills/<skill-name>/SKILL.md`
 * — put agent-owned skills here first. Additional roots are common monorepo / tooling paths.
 *
 * Order matters for UI: the first existing roots are listed first in Lab.
 */
export const SKILL_DIRECTORY_CANDIDATES = [
  ".agents/skills",
  "skills",
  ".claude/skills",
  /** When the scan base is the monorepo root, Cortex’s bundled example skills */
  "apps/cortex/.agents/skills",
] as const;

/**
 * Absolute path to the `apps/cortex` package (parent of `server/`), derived from this module.
 * Used so skill discovery still works when `process.cwd()` is not the repo or `apps/cortex`
 * (e.g. launching the server from `$HOME` or an IDE).
 */
export function getCortexAppRoot(): string {
  return normalize(resolve(fileURLToPath(new URL("../..", import.meta.url))));
}

/**
 * Bases used when scanning for skill directory candidates.
 * - `process.cwd()` — normal CLI / `bun start` from a project folder
 * - Cortex app root — always includes `apps/cortex/.agents/skills` etc. regardless of cwd
 * - optional `CORTEX_SKILL_SCAN_ROOT` — extra absolute path (advanced)
 */
export function getSkillScanBases(primaryCwd: string = process.cwd()): string[] {
  const extra = process.env.CORTEX_SKILL_SCAN_ROOT?.trim();
  const raw = [extra, primaryCwd, getCortexAppRoot()].filter(
    (b): b is string => typeof b === "string" && b.length > 0,
  );
  const seen = new Set<string>();
  return raw.map((b) => normalize(resolve(b))).filter((b) => {
    if (seen.has(b)) return false;
    seen.add(b);
    return true;
  });
}

/** Absolute paths of each existing skill *root* (e.g. `…/.agents/skills`), deduped. */
export function absoluteSkillDirectoryPaths(): string[] {
  const roots = new Set<string>();
  for (const base of getSkillScanBases()) {
    for (const rel of SKILL_DIRECTORY_CANDIDATES) {
      const abs = resolve(base, rel);
      try {
        if (statSync(abs).isDirectory()) roots.add(normalize(abs));
      } catch {
        /* missing */
      }
    }
  }
  return [...roots];
}

/**
 * Candidate relative paths (e.g. `.agents/skills`) that exist under the given absolute bases.
 * For tests that need an isolated filesystem view without the Cortex package root.
 */
export function discoverSkillDirectoryPathsFromBases(bases: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const base of bases) {
    const normBase = normalize(resolve(base));
    for (const rel of SKILL_DIRECTORY_CANDIDATES) {
      const abs = join(normBase, rel);
      try {
        if (statSync(abs).isDirectory()) {
          if (!seen.has(rel)) {
            seen.add(rel);
            out.push(rel);
          }
        }
      } catch {
        /* not found or not accessible */
      }
    }
  }
  return out;
}

/**
 * Candidate relative paths (e.g. `.agents/skills`) that exist under at least one scan base
 * (`cwd`, Cortex app root, optional `CORTEX_SKILL_SCAN_ROOT`).
 */
export function discoverSkillDirectoryPaths(cwd: string = process.cwd()): string[] {
  return discoverSkillDirectoryPathsFromBases(getSkillScanBases(cwd));
}
