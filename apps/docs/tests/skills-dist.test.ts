import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANONICAL_PREFIX,
  LEGACY_PREFIX,
  buildLegacyIndex,
  listSkills,
  run,
  verifySkillsDist,
} from "../scripts/skills-dist.mjs";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const skillMd = (name: string) => `---\nname: ${name}\ndescription: About ${name}.\n---\n\n# ${name}\n`;

/** Fake source skills plus a fake dist as astro-skills 0.1 would emit it. */
function fixture(names: string[]) {
  const root = mkdtempSync(join(tmpdir(), "skills-dist-"));
  dirs.push(root);
  const skillsDir = join(root, "skills");
  const distDir = join(root, "dist");
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(join(distDir, CANONICAL_PREFIX), { recursive: true });
  for (const n of names) {
    mkdirSync(join(skillsDir, n), { recursive: true });
    writeFileSync(join(skillsDir, n, "SKILL.md"), skillMd(n));
    mkdirSync(join(distDir, CANONICAL_PREFIX, n), { recursive: true });
    writeFileSync(join(distDir, CANONICAL_PREFIX, n, "SKILL.md"), skillMd(n));
  }
  const index = {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: names.map((n) => ({
      name: n,
      type: "skill-md",
      description: `About ${n}.`,
      url: `/${CANONICAL_PREFIX}/${n}/SKILL.md`,
      digest: `sha256:${createHash("sha256").update(skillMd(n)).digest("hex")}`,
    })),
  };
  writeFileSync(join(distDir, CANONICAL_PREFIX, "index.json"), JSON.stringify(index));
  return { skillsDir, distDir };
}

describe("skills-dist", () => {
  it("lists skills and builds a legacy v0.1 index (no $schema, files incl. SKILL.md)", () => {
    const { skillsDir } = fixture(["alpha", "beta"]);
    const legacy = buildLegacyIndex(listSkills(skillsDir));
    expect(legacy).toEqual({
      skills: [
        { name: "alpha", description: "About alpha.", files: ["SKILL.md"] },
        { name: "beta", description: "About beta.", files: ["SKILL.md"] },
      ],
    });
  });

  it("mirrors the legacy path and passes verification when the build is healthy", () => {
    const { skillsDir, distDir } = fixture(["alpha", "beta"]);
    const { count, problems } = run(distDir, skillsDir);
    expect(problems).toEqual([]);
    expect(count).toBe(2);
    expect(readFileSync(join(distDir, LEGACY_PREFIX, "beta", "SKILL.md"), "utf-8")).toBe(skillMd("beta"));
  });

  it("fails when a canonical SKILL.md is missing (the silent astro-skills failure)", () => {
    const { skillsDir, distDir } = fixture(["alpha", "beta"]);
    rmSync(join(distDir, CANONICAL_PREFIX, "beta", "SKILL.md"));
    const { problems } = run(distDir, skillsDir);
    expect(problems.some((p) => p.includes("missing agent-skills SKILL.md") && p.includes("beta"))).toBe(true);
  });

  it("fails when the canonical index omits a skill or is absent", () => {
    const { skillsDir, distDir } = fixture(["alpha", "beta"]);
    const path = join(distDir, CANONICAL_PREFIX, "index.json");
    const idx = JSON.parse(readFileSync(path, "utf-8"));
    idx.skills = idx.skills.slice(0, 1);
    writeFileSync(path, JSON.stringify(idx));
    expect(run(distDir, skillsDir).problems.some((p) => p.includes("does not list"))).toBe(true);
    rmSync(path);
    expect(run(distDir, skillsDir).problems.some((p) => p.includes("cannot read/parse"))).toBe(true);
  });

  it("fails when a legacy file goes missing after mirroring", () => {
    const { skillsDir, distDir } = fixture(["alpha"]);
    run(distDir, skillsDir);
    rmSync(join(distDir, LEGACY_PREFIX, "alpha", "SKILL.md"));
    const problems = verifySkillsDist(distDir, listSkills(skillsDir));
    expect(problems.some((p) => p.includes("missing legacy skills SKILL.md"))).toBe(true);
  });

  it("fails when there are no source skills", () => {
    const { skillsDir, distDir } = fixture([]);
    expect(run(distDir, skillsDir).problems).toContain("no skills found in source dir");
  });
});
