import { describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { discoverSkillDirectoryPaths, SKILL_DIRECTORY_CANDIDATES } from "../services/skill-directories.js";

describe("discoverSkillDirectoryPaths", () => {
  test("returns empty when no candidate dirs exist under cwd", async () => {
    const base = join(process.cwd(), `tmp-skill-empty-${Date.now()}`);
    try {
      expect(discoverSkillDirectoryPaths(base)).toEqual([]);
    } finally {
      await rm(base, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("returns relative paths for candidates that exist as directories", async () => {
    const base = join(process.cwd(), `tmp-skill-found-${Date.now()}`);
    await mkdir(join(base, ".claude", "skills"), { recursive: true });
    await mkdir(join(base, "skills"), { recursive: true });
    try {
      const found = discoverSkillDirectoryPaths(base);
      expect(found).toContain(".claude/skills");
      expect(found).toContain("skills");
      expect(found).not.toContain(".agents/skills");
    } finally {
      await rm(base, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("SKILL_DIRECTORY_CANDIDATES is stable for Lab copy", () => {
    expect(SKILL_DIRECTORY_CANDIDATES.length).toBeGreaterThan(0);
  });
});
