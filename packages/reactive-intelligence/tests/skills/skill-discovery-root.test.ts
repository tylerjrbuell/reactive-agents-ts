// Skills spec step 1 (wiki/Architecture/Design-Specs/2026-11-06-skills-and-extension-model.md
// §4, §8 row 1, §11 items 6 and 9): discovery takes an explicit root. Order, earliest wins:
//   1. <root>/.agents/skills, <root>/.<agentId>/skills
//   2. configured paths (relative ones resolve against root, not cwd)
//   3. <root>/.claude/skills (lowest-precedence compat path)
//   4. only with global: true — ~/.agents/skills, ~/.reactive-agents/skills
// HOME points at a tmp dir so the developer's real global skills never leak in.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { discoverSkills } from "../../src/skills/skill-registry.js";
import {
  makeSkillResolverService,
  SkillResolverService,
} from "../../src/skills/skill-resolver.js";

const BASE = path.join(os.tmpdir(), `test-skill-discovery-root-${process.pid}`);
const ROOT = path.join(BASE, "workspace");
const HOME = path.join(BASE, "home");
const ELSEWHERE = path.join(BASE, "elsewhere");

const writeSkill = (dir: string, name: string, description: string): string => {
  const skillDir = path.join(dir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  const file = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\n\nBody of ${name}.`);
  return file;
};

const descOf = (skills: readonly { name: string; description: string }[], name: string) =>
  skills.find((s) => s.name === name)?.description;

describe("discoverSkills — explicit root", () => {
  let savedHome: string | undefined;
  let savedCwd: string;

  beforeEach(() => {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.mkdirSync(HOME, { recursive: true });
    fs.mkdirSync(ELSEWHERE, { recursive: true });
    savedHome = process.env.HOME;
    savedCwd = process.cwd();
    process.env.HOME = HOME;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    process.chdir(savedCwd);
    fs.rmSync(BASE, { recursive: true, force: true });
  });

  it("precedence: workspace beats paths beats .claude compat beats global", () => {
    writeSkill(path.join(ROOT, ".agents", "skills"), "shared", "from-workspace");
    writeSkill(path.join(ROOT, "docs", "skills"), "shared", "from-paths");
    writeSkill(path.join(ROOT, "docs", "skills"), "paths-vs-compat", "from-paths");
    writeSkill(path.join(ROOT, ".claude", "skills"), "shared", "from-compat");
    writeSkill(path.join(ROOT, ".claude", "skills"), "paths-vs-compat", "from-compat");
    writeSkill(path.join(ROOT, ".claude", "skills"), "compat-vs-global", "from-compat");
    writeSkill(path.join(HOME, ".agents", "skills"), "shared", "from-global");
    writeSkill(path.join(HOME, ".agents", "skills"), "compat-vs-global", "from-global");
    writeSkill(path.join(HOME, ".agents", "skills"), "global-only", "from-global");

    const result = discoverSkills(ROOT, ["docs/skills"], { global: true, agentId: "agent-1" });

    // Every tier was scanned (the global tier is not vacuously absent).
    expect(descOf(result.skills, "global-only")).toBe("from-global");
    expect(descOf(result.skills, "shared")).toBe("from-workspace");
    expect(descOf(result.skills, "paths-vs-compat")).toBe("from-paths");
    expect(descOf(result.skills, "compat-vs-global")).toBe("from-compat");
  });

  it("the agent-scoped workspace dir is a first-tier source and beats configured paths", () => {
    writeSkill(path.join(ROOT, ".agent-1", "skills"), "scoped", "from-agent-dir");
    writeSkill(path.join(ROOT, "docs", "skills"), "scoped", "from-paths");

    const result = discoverSkills(ROOT, ["docs/skills"], { agentId: "agent-1" });

    expect(descOf(result.skills, "scoped")).toBe("from-agent-dir");
  });

  it("a relative configured path resolves against root, not cwd", () => {
    writeSkill(path.join(ROOT, "docs", "skills"), "rooted", "under-root");
    writeSkill(path.join(ELSEWHERE, "docs", "skills"), "decoy", "under-cwd");
    process.chdir(ELSEWHERE);

    const result = discoverSkills(ROOT, ["docs/skills"]);

    expect(result.skills.map((s) => s.name)).toEqual(["rooted"]);
    expect(result.skills[0]!.filePath).toBe(path.join(ROOT, "docs", "skills", "rooted", "SKILL.md"));
  });

  it("an absolute configured path is used as-is", () => {
    writeSkill(path.join(ELSEWHERE, "abs"), "absolute", "abs-path");

    const result = discoverSkills(ROOT, [path.join(ELSEWHERE, "abs")]);

    expect(result.skills.map((s) => s.name)).toEqual(["absolute"]);
  });

  it("globals are absent unless global: true", () => {
    writeSkill(path.join(HOME, ".agents", "skills"), "home-a", "global a");
    writeSkill(path.join(HOME, ".reactive-agents", "skills"), "home-b", "global b");
    writeSkill(path.join(ROOT, ".agents", "skills"), "ws", "workspace");

    const off = discoverSkills(ROOT, []);
    expect(off.skills.map((s) => s.name)).toEqual(["ws"]);

    const offExplicit = discoverSkills(ROOT, [], { global: false });
    expect(offExplicit.skills.map((s) => s.name)).toEqual(["ws"]);

    const on = discoverSkills(ROOT, [], { global: true });
    expect(on.skills.map((s) => s.name).sort()).toEqual(["home-a", "home-b", "ws"]);
  });

  it("~/.agents/skills beats ~/.reactive-agents/skills", () => {
    writeSkill(path.join(HOME, ".agents", "skills"), "g", "agents-home");
    writeSkill(path.join(HOME, ".reactive-agents", "skills"), "g", "ra-home");

    const result = discoverSkills(ROOT, [], { global: true });

    expect(descOf(result.skills, "g")).toBe("agents-home");
  });

  it("a collision keeps the earlier source and records the discarded one", () => {
    const kept = writeSkill(path.join(ROOT, ".agents", "skills"), "dup", "first");
    const discarded = writeSkill(path.join(ROOT, ".claude", "skills"), "dup", "second");

    const result = discoverSkills(ROOT, []);

    expect(result.skills).toHaveLength(1);
    expect(descOf(result.skills, "dup")).toBe("first");
    expect(result.collisions).toEqual([{ name: "dup", kept, discarded }]);
  });

  it("the same directory listed twice is scanned once (no self-collision)", () => {
    writeSkill(path.join(ROOT, ".agents", "skills"), "once", "x");

    const result = discoverSkills(ROOT, [".agents/skills", path.join(ROOT, ".agents", "skills")]);

    expect(result.skills.map((s) => s.name)).toEqual(["once"]);
    expect(result.collisions).toHaveLength(0);
  });
});

describe("SkillResolverService.resolve — root and includeGlobal", () => {
  let savedHome: string | undefined;

  beforeEach(() => {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.mkdirSync(HOME, { recursive: true });
    fs.mkdirSync(ELSEWHERE, { recursive: true });
    savedHome = process.env.HOME;
    process.env.HOME = HOME;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    fs.rmSync(BASE, { recursive: true, force: true });
  });

  const resolveNames = (
    config: Parameters<typeof makeSkillResolverService>[0],
    params: { root?: string; includeGlobal?: boolean } = {},
  ) =>
    Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const resolver = yield* SkillResolverService;
          const r = yield* resolver.resolve({
            taskDescription: "unrelated",
            modelId: "m",
            agentId: "agent-1",
            ...params,
          });
          return r.all.map((s) => s.name).sort();
        }),
        makeSkillResolverService(config),
      ),
    );

  it("excludes globals by default", async () => {
    writeSkill(path.join(HOME, ".agents", "skills"), "home-only", "g");
    writeSkill(path.join(ROOT, ".agents", "skills"), "ws-only", "w");

    const names = await resolveNames({ customPaths: [], agentId: "agent-1", projectRoot: ROOT });

    expect(names).toEqual(["ws-only"]);
  });

  it("includeGlobal in config adds globals", async () => {
    writeSkill(path.join(HOME, ".agents", "skills"), "home-only", "g");

    const names = await resolveNames({
      customPaths: [],
      agentId: "agent-1",
      projectRoot: ROOT,
      includeGlobal: true,
    });

    expect(names).toEqual(["home-only"]);
  });

  it("per-call root overrides the configured fallback root, and relative paths follow it", async () => {
    writeSkill(path.join(ROOT, "docs", "skills"), "in-run-root", "r");
    writeSkill(path.join(ELSEWHERE, "docs", "skills"), "in-fallback", "f");

    const names = await resolveNames(
      { customPaths: ["docs/skills"], agentId: "agent-1", projectRoot: ELSEWHERE },
      { root: ROOT },
    );

    expect(names).toEqual(["in-run-root"]);
  });

  it("per-call includeGlobal overrides config", async () => {
    writeSkill(path.join(HOME, ".agents", "skills"), "home-only", "g");

    const on = await resolveNames(
      { customPaths: [], agentId: "agent-1", projectRoot: ROOT },
      { includeGlobal: true },
    );
    const off = await resolveNames(
      { customPaths: [], agentId: "agent-1", projectRoot: ROOT, includeGlobal: true },
      { includeGlobal: false },
    );

    expect(on).toEqual(["home-only"]);
    expect(off).toEqual([]);
  });
});
