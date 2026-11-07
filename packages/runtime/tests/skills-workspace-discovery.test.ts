// Run: bun test packages/runtime/tests/skills-workspace-discovery.test.ts --timeout 20000
//
// Skills spec step 2 (wiki/Architecture/Design-Specs/2026-11-06-skills-and-extension-model.md §4, §7):
// skills resolve PER RUN at the run's file root, globals are opt-in, `.withSkills()` needs
// no args, `run(task, { skills: { activate } })` pins per run, and `run-started.config.skills`
// records `{ roots, catalog: [{ name, sha256 }], pinned }` only when skills are configured.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrace } from "@reactive-agents/trace";
import type { SkillRecord } from "@reactive-agents/core";
import { parseSKILLmd } from "@reactive-agents/reactive-intelligence";
import { ReactiveAgents } from "../src/builder.js";
import { buildRunSkillsRecord, withRunPins } from "../src/engine/bootstrap/skill-resolve.js";
import { buildRunConfigSnapshot } from "../src/engine/execute-run-config.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

const BASE = mkdtempSync(join(tmpdir(), "ra-skills-ws-"));
const TRACE_DIR = join(BASE, "traces");
const WORKSPACE = join(BASE, "workspace");
const FAKE_HOME = join(BASE, "home");
const PRIOR = {
  dir: process.env.REACTIVE_AGENTS_TRACE_DIR,
  flag: process.env.REACTIVE_AGENTS_TRACE,
  home: process.env.HOME,
};

const WS_BODY = "# Zeta procedure\n\nWrite the zeta marker file.";

const writeSkill = (dir: string, name: string, body: string): void => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(
    join(dir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: "Internal ${name} procedure."\n---\n\n${body}\n`,
    "utf8",
  );
};

beforeAll(() => {
  mkdirSync(TRACE_DIR, { recursive: true });
  writeSkill(join(WORKSPACE, ".agents", "skills"), "zeta-proc", WS_BODY);
  writeSkill(join(WORKSPACE, "docs", "skills"), "docs-proc", "# Docs procedure");
  writeSkill(join(FAKE_HOME, ".agents", "skills"), "home-proc", "# Home procedure");
  process.env.REACTIVE_AGENTS_TRACE_DIR = TRACE_DIR;
  delete process.env.REACTIVE_AGENTS_TRACE;
  // Hermetic globals: discovery reads HOME per call.
  process.env.HOME = FAKE_HOME;
});

afterAll(() => {
  if (PRIOR.dir === undefined) delete process.env.REACTIVE_AGENTS_TRACE_DIR;
  else process.env.REACTIVE_AGENTS_TRACE_DIR = PRIOR.dir;
  if (PRIOR.flag !== undefined) process.env.REACTIVE_AGENTS_TRACE = PRIOR.flag;
  if (PRIOR.home === undefined) delete process.env.HOME;
  else process.env.HOME = PRIOR.home;
  rmSync(BASE, { recursive: true, force: true });
});

type SkillsRecord = {
  roots: string[];
  catalog: { name: string; sha256: string }[];
  pinned: string[];
};

type Builder = ReturnType<typeof ReactiveAgents.create>;

/** Build, run once in WORKSPACE, return the run's output + `run-started.config`. */
const runOnce = async (
  configure: (b: Builder) => Builder,
  runOpts: Parameters<Awaited<ReturnType<Builder["build"]>>["run"]>[1] = { workspace: WORKSPACE },
): Promise<{ output: string; config: { skills?: SkillsRecord } & Record<string, unknown> }> => {
  const agent = await configure(
    ReactiveAgents.create()
      .withName("skills-ws")
      .withTestScenario([
        // Fires only when an activated skill's full body is in the prompt.
        { text: "FINAL ANSWER: body present", match: "Write the zeta marker file" },
        { text: "FINAL ANSWER: body absent" },
      ]),
  )
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(2)
    .build();
  const result = await agent.run("Say hello.", runOpts);
  await agent.dispose();
  const events = (await loadTrace(result.metadata.tracePath!)).events;
  const started = events.find((e) => e.kind === "run-started");
  const config = (started?.kind === "run-started" ? started.config : {}) as {
    skills?: SkillsRecord;
  } & Record<string, unknown>;
  return { output: String(result.output ?? ""), config };
};

const names = (r: SkillsRecord | undefined): string[] => (r?.catalog ?? []).map((c) => c.name);

describe("skills: per-run workspace discovery", () => {
  it("default run (no withSkills) has no skills key in run-started.config", async () => {
    const { config } = await runOnce((b) => b);
    expect("skills" in config).toBe(false);
  }, 30000);

  it(".withSkills() with no args lists the run workspace's .agents/skills", async () => {
    const { config } = await runOnce((b) => b.withSkills());
    const skills = config.skills!;
    expect(names(skills)).toEqual(["zeta-proc"]);
    expect(skills.roots).toContain(join(WORKSPACE, ".agents", "skills"));
    expect(skills.roots).toContain(join(WORKSPACE, ".claude", "skills"));
    expect(skills.pinned).toEqual([]);
    // sha256 of the body as parsed (instructions = SKILL.md after frontmatter).
    const body = parseSKILLmd(join(WORKSPACE, ".agents", "skills", "zeta-proc", "SKILL.md"))!.instructions;
    expect(body).toContain(WS_BODY);
    const expectedSha = createHash("sha256").update(body).digest("hex");
    expect(skills.catalog[0]!.sha256).toBe(expectedSha);
  }, 30000);

  it("relative paths resolve against the run's workspace, not cwd", async () => {
    const { config } = await runOnce((b) => b.withSkills({ paths: ["docs/skills"] }));
    expect(names(config.skills)).toEqual(["docs-proc", "zeta-proc"]);
    expect(config.skills!.roots).toContain(join(WORKSPACE, "docs", "skills"));
  }, 30000);

  it("global skills under HOME are absent without global: true", async () => {
    const { config } = await runOnce((b) => b.withSkills());
    expect(names(config.skills)).not.toContain("home-proc");
    expect(config.skills!.roots).not.toContain(join(FAKE_HOME, ".agents", "skills"));
  }, 30000);

  it("global skills under HOME are present with global: true", async () => {
    const { config } = await runOnce((b) => b.withSkills({ global: true }));
    expect(names(config.skills)).toContain("home-proc");
    expect(config.skills!.roots).toContain(join(FAKE_HOME, ".agents", "skills"));
  }, 30000);

  it("an unpinned, task-irrelevant skill body is NOT injected", async () => {
    const { output } = await runOnce((b) => b.withSkills());
    expect(output).toContain("body absent");
  }, 30000);

  it("run(task, { skills: { activate } }) pins for that run and is recorded", async () => {
    const { output, config } = await runOnce((b) => b.withSkills(), {
      workspace: WORKSPACE,
      skills: { activate: ["zeta-proc"] },
    });
    expect(output).toContain("body present");
    expect(config.skills!.pinned).toEqual(["zeta-proc"]);
  }, 30000);

  it("builder pins and run pins merge in the record", async () => {
    const { config } = await runOnce((b) => b.withSkills({ activate: ["docs-proc"], paths: ["docs/skills"] }), {
      workspace: WORKSPACE,
      skills: { activate: ["zeta-proc", "docs-proc"] },
    });
    expect(config.skills!.pinned).toEqual(["docs-proc", "zeta-proc"]);
  }, 30000);
});

const rec = (name: string, instructions = name): SkillRecord => ({
  id: name,
  name,
  description: name,
  agentId: "a",
  source: "installed",
  instructions,
  version: 1,
  versionHistory: [],
  config: { strategy: "reactive", temperature: 0.7, maxIterations: 5, promptTemplateId: "default", systemPromptTokens: 0, compressionEnabled: false },
  evolutionMode: "locked",
  confidence: "trusted",
  successRate: 0,
  useCount: 0,
  refinementCount: 0,
  taskCategories: [],
  modelAffinities: [],
  base: null,
  avgPostActivationEntropyDelta: 0,
  avgConvergenceIteration: 0,
  convergenceSpeedTrend: [],
  conflictsWith: [],
  lastActivatedAt: null,
  lastRefinedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  contentVariants: { full: instructions, summary: null, condensed: null },
});

describe("skill-resolve pure helpers", () => {
  it("withRunPins adds matching skills case-insensitively, without duplicates", () => {
    const a = rec("Alpha");
    const b = rec("beta");
    const out = withRunPins({ all: [a, b], autoActivate: [b], catalog: [a, b] }, ["alpha", "BETA", "missing"]);
    expect(out.autoActivate.map((s) => s.name)).toEqual(["beta", "Alpha"]);
  });

  it("buildRunSkillsRecord sorts the catalog by name and dedupes pins", () => {
    const r = buildRunSkillsRecord({ roots: ["/r"], catalog: [rec("b"), rec("a")], pinned: ["x", "x", "y"] });
    expect(r.catalog.map((c) => c.name)).toEqual(["a", "b"]);
    expect(r.pinned).toEqual(["x", "y"]);
  });

  it("run config snapshot caps the catalog at 50 and records the real count", () => {
    const catalog = Array.from({ length: 60 }, (_, i) => ({ name: `s${i}`, sha256: "0" }));
    const snap = buildRunConfigSnapshot({
      config: defaultReactiveAgentsConfig("cap"),
      provider: "test",
      model: "test",
      lean: false,
      skills: { roots: [], catalog, pinned: [] },
    });
    expect(snap.skills?.catalog.length).toBe(50);
    expect(snap.skills?.catalogTotal).toBe(60);
  });
});
