// Post-build step for the public consumer skills (apps/docs/skills/**).
//
// 1. Mirrors every skill to the LEGACY discovery path `/.well-known/skills/`
//    (index.json in the v0.1 `files` schema). astro-skills >= 0.1 only serves
//    `/.well-known/agent-skills/` (Agent Skills Discovery v0.2.0). External
//    `npx skills add` users and older CLIs still probe the old path, so we keep
//    it working. skills CLI 1.9 probes `agent-skills` first, then `skills`.
// 2. Asserts the build really published every skill under BOTH paths. A green
//    `astro build` can silently publish zero skills (astro-skills 0.1 drops any
//    collection entry missing `type`/`digest`/`skillMdRaw`), so this fails loud.
//
// Plain ESM so the Astro config and `bun test` can both use it. Run after the
// build: `node scripts/skills-dist.mjs [distDir] [skillsDir]`.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

export const CANONICAL_PREFIX = ".well-known/agent-skills";
export const LEGACY_PREFIX = ".well-known/skills";
const DISCOVERY_SCHEMA_V2 = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const posix = (p) => p.split(sep).join("/");

/** Every skill under `skillsDir` (a dir holding a SKILL.md; id is its path). */
export function listSkills(skillsDir) {
  const skills = [];
  for (const file of walk(skillsDir)) {
    if (!file.endsWith(`${sep}SKILL.md`)) continue;
    const dir = dirname(file);
    const id = posix(relative(skillsDir, dir));
    const raw = readFileSync(file, "utf-8");
    const { data } = matter(raw);
    skills.push({
      id,
      raw,
      name: typeof data.name === "string" ? data.name : id,
      description: typeof data.description === "string" ? data.description : "",
      files: walk(dir).map((f) => posix(relative(dir, f))).sort(),
      dir,
    });
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

/** Legacy (v0.1) index: `{ skills: [{ name, description, files }] }`, no `$schema`. */
export function buildLegacyIndex(skills) {
  return {
    skills: skills.map((s) => ({ name: s.id, description: s.description, files: s.files })),
  };
}

/** Write `dist/.well-known/skills/**` (legacy index + every skill file). */
export function writeLegacyPath(distDir, skills) {
  const root = join(distDir, LEGACY_PREFIX);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "index.json"), `${JSON.stringify(buildLegacyIndex(skills), null, 2)}\n`);
  for (const skill of skills) {
    for (const rel of skill.files) {
      const dest = join(root, skill.id, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(join(skill.dir, rel)));
    }
  }
}

function readJson(path, problems) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    problems.push(`cannot read/parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function checkFile(path, expected, problems, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    problems.push(`missing ${label}: ${path}`);
    return;
  }
  if (readFileSync(path, "utf-8") !== expected) problems.push(`content differs from source: ${path}`);
}

/** Returns a list of problems; empty means every skill is served under both paths. */
export function verifySkillsDist(distDir, skills) {
  const problems = [];
  if (skills.length === 0) problems.push("no skills found in source dir");

  const canonicalIndex = readJson(join(distDir, CANONICAL_PREFIX, "index.json"), problems);
  if (canonicalIndex) {
    if (canonicalIndex.$schema !== DISCOVERY_SCHEMA_V2) problems.push(`agent-skills index $schema is ${canonicalIndex.$schema}`);
    const entries = new Map((canonicalIndex.skills ?? []).map((e) => [e.url, e]));
    for (const skill of skills) {
      const url = `/${CANONICAL_PREFIX}/${skill.id}/SKILL.md`;
      const entry = entries.get(url);
      if (!entry) problems.push(`agent-skills index.json does not list ${url}`);
      else if (entry.digest !== `sha256:${createHash("sha256").update(skill.raw).digest("hex")}`) {
        problems.push(`agent-skills index digest mismatch for ${skill.id}`);
      }
    }
    if ((canonicalIndex.skills ?? []).length !== skills.length) {
      problems.push(`agent-skills index lists ${(canonicalIndex.skills ?? []).length} skills, source has ${skills.length}`);
    }
  }

  const legacyIndex = readJson(join(distDir, LEGACY_PREFIX, "index.json"), problems);
  if (legacyIndex) {
    const names = new Set((legacyIndex.skills ?? []).map((e) => e.name));
    for (const skill of skills) if (!names.has(skill.id)) problems.push(`legacy skills index.json does not list ${skill.id}`);
    if ((legacyIndex.skills ?? []).length !== skills.length) {
      problems.push(`legacy index lists ${(legacyIndex.skills ?? []).length} skills, source has ${skills.length}`);
    }
  }

  for (const skill of skills) {
    checkFile(join(distDir, CANONICAL_PREFIX, skill.id, "SKILL.md"), skill.raw, problems, "agent-skills SKILL.md");
    checkFile(join(distDir, LEGACY_PREFIX, skill.id, "SKILL.md"), skill.raw, problems, "legacy skills SKILL.md");
  }
  return problems;
}

/** Mirror legacy path then verify both. Returns `{ count, problems }`. */
export function run(distDir, skillsDir) {
  const skills = listSkills(skillsDir);
  writeLegacyPath(distDir, skills);
  return { count: skills.length, problems: verifySkillsDist(distDir, skills) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const distDir = resolve(process.argv[2] ?? join(here, "..", "dist"));
  const skillsDir = resolve(process.argv[3] ?? join(here, "..", "skills"));
  const { count, problems } = run(distDir, skillsDir);
  if (problems.length > 0) {
    console.error(`skills-dist: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`skills-dist: ${count} skills served under /${CANONICAL_PREFIX}/ and /${LEGACY_PREFIX}/`);
}
