// Run: bun test packages/runtime/tests/skills-activation-runtime.test.ts --timeout 20000
//
// Skills spec step 4, runtime half
// (wiki/Architecture/Design-Specs/2026-11-06-skills-and-extension-model.md §4-§5):
// the runtime fills `KernelInput.skillsContext.skills` from the run's resolved
// skills, so an agent with a workspace skill can load it mid-run with
// `activate-skill`. A run without skills offers no `activate-skill` and its
// wire tools do not change.
//
// ORACLE: the run's own trace. `llm-exchange.toolSchemaNames` is the schema
// list of the real provider request; its `messages` carry the tool result the
// model saw; `ledger-entry` carries the `skill-activated` fact.
//
// RED-ON-CUT: drop the `skills` spread in skill-activatable.ts
// `skillsContextFromMetadata` and the activation case fails (no activate-skill
// in toolSchemaNames, no body in the tool message, no fact).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Schema } from "effect";
import { loadTrace, type TraceEvent } from "@reactive-agents/trace";
import { AgentId, generateTaskId, type SkillRecord, type Task } from "@reactive-agents/core";
import { SkillResolverService, type ActivatableSkill } from "@reactive-agents/reactive-intelligence";
import { ReactiveAgents } from "../src/builder.js";
import {
  ACTIVATABLE_SKILLS_KEY,
  PINNED_SKILLS_KEY,
  skillsContextFromMetadata,
} from "../src/engine/bootstrap/skill-activatable.js";
import { resolveRunSkills } from "../src/engine/bootstrap/skill-resolve.js";
import { AgentSkills } from "../src/runtime-skills-layer.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

const BASE = mkdtempSync(join(tmpdir(), "ra-skills-act-"));
const TRACE_DIR = join(BASE, "traces");
const WORKSPACE = join(BASE, "workspace");
const EMPTY_WORKSPACE = join(BASE, "empty-workspace");
const FAKE_HOME = join(BASE, "home");
const PRIOR = {
  dir: process.env.REACTIVE_AGENTS_TRACE_DIR,
  flag: process.env.REACTIVE_AGENTS_TRACE,
  home: process.env.HOME,
};

/** Only in the SKILL.md body, never in the catalog: seeing it means the body loaded. */
const BODY_MARKER = "Write the omega marker with three dashes.";

beforeAll(() => {
  mkdirSync(TRACE_DIR, { recursive: true });
  mkdirSync(EMPTY_WORKSPACE, { recursive: true });
  mkdirSync(FAKE_HOME, { recursive: true });
  const dir = join(WORKSPACE, ".agents", "skills", "demo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: demo\ndescription: "Internal demo procedure."\n---\n\n# Demo procedure\n\n${BODY_MARKER}\n`,
    "utf8",
  );
  process.env.REACTIVE_AGENTS_TRACE_DIR = TRACE_DIR;
  delete process.env.REACTIVE_AGENTS_TRACE;
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

type Builder = ReturnType<typeof ReactiveAgents.create>;

/**
 * The task shares no word with the skill's name or description, so relevance
 * does not pin it: the body can only arrive through activate-skill.
 */
const runOnce = async (
  configure: (b: Builder) => Builder,
  workspace: string = WORKSPACE,
  activate?: readonly string[],
): Promise<{ output: string; events: readonly TraceEvent[] }> => {
  const agent = await configure(
    ReactiveAgents.create()
      .withName("skills-act")
      .withTestScenario([
        { toolCalls: [{ name: "activate-skill", args: { name: "demo" } }] },
        { match: BODY_MARKER, text: "FINAL ANSWER: body loaded" },
        { text: "FINAL ANSWER: body missing" },
      ]),
  )
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(3)
    .build();
  let result: Awaited<ReturnType<typeof agent.run>>;
  try {
    result = await agent.run("Say hello.", {
      workspace,
      ...(activate ? { skills: { activate } } : {}),
    });
  } finally {
    await agent.dispose();
  }
  // Read after dispose: the trace's last batches are flushed then.
  const events = (await loadTrace(result.metadata.tracePath!)).events;
  return { output: String(result.output ?? ""), events };
};

const toolMessages = (events: readonly TraceEvent[]) =>
  exchanges(events).flatMap((e) => e.messages.filter((m) => m.role === "tool"));

const exchanges = (events: readonly TraceEvent[]) =>
  events.flatMap((e) => (e.kind === "llm-exchange" && e.purpose !== "classify" ? [e] : []));

const schemaNames = (events: readonly TraceEvent[]): Set<string> =>
  new Set(exchanges(events).flatMap((e) => [...e.toolSchemaNames]));

const ledgerEntries = (events: readonly TraceEvent[]): Record<string, unknown>[] =>
  events.flatMap((e) => (e.kind === "ledger-entry" ? [...e.entries] : []));

describe("activate-skill end to end (runtime fills skillsContext.skills)", () => {
  it("an agent with a workspace skill loads it mid-run", async () => {
    const { output, events } = await runOnce((b) => b.withSkills());

    expect(schemaNames(events).has("activate-skill")).toBe(true);

    // The tool result carries the body, and the next turn saw it.
    expect(toolMessages(events).some((m) => m.content.includes(BODY_MARKER))).toBe(true);
    expect(output).toContain("body loaded");

    const started = events.find((e) => e.kind === "run-started");
    const skills = (started?.kind === "run-started" ? started.config : {}) as {
      skills?: { catalog: { name: string }[] };
    };
    expect(skills.skills?.catalog.map((c) => c.name)).toEqual(["demo"]);

    const facts = ledgerEntries(events).filter((e) => e["kind"] === "skill-activated");
    expect(facts.length).toBe(1);
    expect(facts[0]!["name"]).toBe("demo");
    expect(facts[0]!["via"]).toBe("agent");
  }, 30000);

  it("a skill pinned for the run answers 'already loaded' and records no fact", async () => {
    const { output, events } = await runOnce((b) => b.withSkills(), WORKSPACE, ["demo"]);
    expect(output).toContain("body loaded"); // the pinned body is in the system prompt
    const tool = toolMessages(events).map((m) => m.content);
    expect(tool.some((c) => c.includes("already loaded"))).toBe(true);
    expect(tool.some((c) => c.includes(BODY_MARKER))).toBe(false);
    expect(ledgerEntries(events).filter((e) => e["kind"] === "skill-activated")).toEqual([]);
  }, 30000);

  it("a run without withSkills offers no activate-skill and keeps its wire tools", async () => {
    const without = await runOnce((b) => b);
    const withSkills = await runOnce((b) => b.withSkills());
    const plain = schemaNames(without.events);
    expect(plain.has("activate-skill")).toBe(false);
    expect(without.output).toContain("body missing");
    const added = [...schemaNames(withSkills.events)].filter((n) => !plain.has(n));
    expect(added).toEqual(["activate-skill"]);
  }, 60000);

  it("withSkills() over a workspace with no skills offers no activate-skill", async () => {
    const { events } = await runOnce((b) => b.withSkills(), EMPTY_WORKSPACE);
    expect(schemaNames(events).has("activate-skill")).toBe(false);
  }, 30000);
});

const record = (name: string, source: SkillRecord["source"], instructions = `${name} body`): SkillRecord => ({
  id: name,
  name,
  description: name,
  agentId: "a",
  source,
  instructions,
  version: 2,
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

const SHA = "0".repeat(64);
const installedSkill: ActivatableSkill = {
  body: "a body",
  dir: "/skills/a",
  sha256: SHA,
  version: 2,
  source: "installed",
  resources: { scripts: [], references: ["guide.md"] },
};
const learnedSkill: ActivatableSkill = { body: "b body", sha256: SHA, version: 1, source: "learned" };

/**
 * Run `resolveRunSkills` against a stub resolver whose `activatable` map holds
 * one filesystem skill and one learned skill (no directory).
 */
const resolveWithStub = (withSettings: boolean) => {
  const catalog = [record("a", "installed"), record("b", "learned")];
  const resolver = Layer.succeed(SkillResolverService, {
    resolve: () =>
      Effect.succeed({
        all: catalog,
        autoActivate: [],
        catalog,
        activatable: new Map([
          ["a", installedSkill],
          ["b", learnedSkill],
        ]),
      }),
    generateCatalogXml: () => "<available_skills/>",
  });
  const settings = Layer.succeed(AgentSkills, {
    paths: [],
    activate: [],
    global: false,
    fallbackRoot: EMPTY_WORKSPACE,
  });
  const task: Task = {
    id: generateTaskId(),
    agentId: Schema.decodeSync(AgentId)("skills-act"),
    type: "query",
    input: { question: "Say hello." },
    priority: "medium",
    status: "pending",
    metadata: { tags: [] },
    createdAt: new Date(),
  };
  const run = resolveRunSkills({ task, config: defaultReactiveAgentsConfig("skills-act"), modelId: "test" });
  return Effect.runPromise(
    run.pipe(Effect.provide(withSettings ? Layer.merge(resolver, settings) : resolver)),
  );
};

describe("skill-activatable helpers", () => {
  // RED-ON-CUT: re-derive `activatable` from a second discovery scan in
  // skill-resolve.ts and the learned skill (no file on disk) drops out.
  it("a learned skill is activatable without a directory, through the metadata round-trip", async () => {
    const out = await resolveWithStub(true);
    expect(out?.activatable.map((e) => e.name)).toEqual(["a", "b"]);
    const ctx = skillsContextFromMetadata({
      skillCatalogXml: out?.catalogXml,
      [ACTIVATABLE_SKILLS_KEY]: out?.activatable,
    });
    expect(ctx?.skills?.get("a")?.dir).toBe("/skills/a");
    expect(ctx?.skills?.get("a")?.resources).toEqual({ scripts: [], references: ["guide.md"] });
    const learned = ctx?.skills?.get("b");
    expect(learned?.body).toBe("b body");
    expect(learned?.source).toBe("learned");
    expect(learned && "dir" in learned).toBe(false);
  });

  it("a resolver without AgentSkills still hands its activatable skills over", async () => {
    const out = await resolveWithStub(false);
    expect(out?.record).toBeUndefined();
    expect(out?.activatable.map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("skillsContextFromMetadata sets skills and pinned only when a skill is activatable", () => {
    expect(skillsContextFromMetadata({})).toBeUndefined();
    const catalogOnly = skillsContextFromMetadata({ skillCatalogXml: "<available_skills/>" });
    expect(catalogOnly?.catalogXml).toBe("<available_skills/>");
    expect(catalogOnly && "skills" in catalogOnly).toBe(false);

    const ctx = skillsContextFromMetadata({
      skillCatalogXml: "<available_skills/>",
      activatedSkillsXml: "<skill_content/>",
      [ACTIVATABLE_SKILLS_KEY]: [
        { name: "a", ...installedSkill },
        { name: "bad", body: "x", dir: "", sha256: "0" },
        { name: "nobody", sha256: "0" },
      ],
      [PINNED_SKILLS_KEY]: ["a"],
    });
    expect([...(ctx?.skills?.keys() ?? [])]).toEqual(["a"]);
    expect(ctx?.skills?.get("a")?.dir).toBe("/skills/a");
    expect(ctx?.pinned).toEqual(["a"]);
  });
});
