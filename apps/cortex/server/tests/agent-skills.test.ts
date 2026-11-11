// Run: bun test apps/cortex/server/tests/agent-skills.test.ts --timeout 15000
//
// Living skills API (api/agent-skills.ts + services/agent-skills.ts):
//   - skills, stats and version history come from the agent's framework SkillStore
//     (agent.skills() on the inspector agent), never from memory.db directly;
//   - rollback restores the previous version; export writes SKILL.md into the workspace;
//   - a Cortex library row moves into the agent's skills (loadSkill) and leaves the library;
//   - refine runs on the agent's last recorded model, through an injected agent factory;
//   - lifecycle events come from stored run events, linked to the run their taskId names.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillRecord } from "@reactive-agents/core";
import { SkillStoreService } from "@reactive-agents/memory";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { applySchema } from "../db/schema.js";
import { agentSkillsRouter } from "../api/agent-skills.js";
import { MemoryInspector } from "../services/memory-inspector.js";
import { AgentSkillsService, librarySkillMarkdown, type RefineAgentFactory } from "../services/agent-skills.js";
import type { AgentSkillDto } from "../services/agent-skills.js";

const BASE = mkdtempSync(join(tmpdir(), "cortex-agent-skills-"));
const WS = mkdtempSync(join(tmpdir(), "cortex-agent-skills-ws-"));
const dbPathOf = (agentId: string): string => join(BASE, agentId, "memory.db");
const AGENT = "agent-skilled";

const inspector = new MemoryInspector(dbPathOf);
const refineCalls: { provider: string; model?: string; dbPath: string }[] = [];
const refineAgent: RefineAgentFactory = (args) => {
  refineCalls.push({ provider: args.provider, ...(args.model ? { model: args.model } : {}), dbPath: args.dbPath });
  return ReactiveAgents.create().withAgentId(args.agentId).withProvider("test").withMemory({ dbPath: args.dbPath }).build();
};
const cortexDb = new Database(":memory:");
applySchema(cortexDb);
const app = agentSkillsRouter(new AgentSkillsService(inspector, refineAgent), cortexDb);

const req = (method: string, path: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    }),
  );

const CONFIG = {
  strategy: "reactive",
  temperature: 0.7,
  maxIterations: 5,
  promptTemplateId: "default",
  systemPromptTokens: 0,
  compressionEnabled: false,
};

const seedSkill = (name: string): SkillRecord => {
  const at = new Date("2026-11-01T00:00:00Z");
  return {
    id: `learned-${name}`,
    name,
    description: "Write deploy notes",
    agentId: AGENT,
    source: "learned",
    instructions: "Step one.\nStep two, refined.",
    version: 2,
    versionHistory: [],
    config: CONFIG,
    evolutionMode: "auto",
    confidence: "trusted",
    successRate: 0.75,
    useCount: 4,
    refinementCount: 1,
    taskCategories: ["ops"],
    modelAffinities: [],
    base: null,
    avgPostActivationEntropyDelta: 0,
    avgConvergenceIteration: 0,
    convergenceSpeedTrend: [],
    conflictsWith: [],
    lastActivatedAt: at,
    lastRefinedAt: at,
    createdAt: at,
    updatedAt: at,
    contentVariants: { full: "Step one.\nStep two, refined.", summary: null, condensed: null },
  };
};

beforeAll(async () => {
  mkdirSync(join(BASE, AGENT), { recursive: true });
  const agent = await ReactiveAgents.create()
    .withAgentId(AGENT)
    .withProvider("test")
    .withMemory({ dbPath: dbPathOf(AGENT) })
    .build();
  try {
    await agent.runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* SkillStoreService;
        const s = seedSkill("deploy-notes");
        yield* store.store(s);
        yield* store.addVersion(s.id, { version: 1, instructions: "Step one.\nStep two.", config: CONFIG, refinedAt: s.createdAt, successRateAtRefinement: 0.8, status: "active" });
        yield* store.addVersion(s.id, { version: 2, instructions: s.instructions, config: CONFIG, refinedAt: s.createdAt, successRateAtRefinement: 0.8, status: "candidate" });
      }),
    );
  } finally {
    await agent.dispose();
  }
});

afterAll(async () => {
  await inspector.disposeAll();
  rmSync(BASE, { recursive: true, force: true });
  rmSync(WS, { recursive: true, force: true });
});

const listSkills = async (): Promise<AgentSkillDto[]> => ((await (await req("GET", `/api/agent-skills/${AGENT}`)).json()) as { skills: AgentSkillDto[] }).skills;

describe("GET /api/agent-skills/:agentId", () => {
  it("lists the stored skill with confidence, usage and versions", async () => {
    const res = await req("GET", `/api/agent-skills/${AGENT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; skills: AgentSkillDto[]; refineWith: unknown };
    expect(body.available).toBe(true);
    expect(body.refineWith).toBeNull();
    const s = body.skills.find((x) => x.name === "deploy-notes")!;
    expect(s).toMatchObject({ confidence: "trusted", evolutionMode: "auto", version: 2, useCount: 4, successRate: 0.75 });
    expect(s.lastActivatedAt).toBe("2026-11-01T00:00:00.000Z");
    expect(s.versions.map((v) => [v.version, v.status])).toEqual([
      [1, "active"],
      [2, "candidate"],
    ]);
  });

  it("an agent without a memory database is unavailable and nothing is created", async () => {
    const body = (await (await req("GET", "/api/agent-skills/nobody")).json()) as { available: boolean; skills: unknown[] };
    expect(body).toMatchObject({ available: false, skills: [] });
    expect(existsSync(dbPathOf("nobody"))).toBe(false);
  });
});

describe("export and rollback", () => {
  it("exports SKILL.md into the workspace's .agents/skills", async () => {
    const res = await req("POST", `/api/agent-skills/${AGENT}/skills/deploy-notes/export`, { root: WS });
    expect(res.status).toBe(200);
    const { path } = (await res.json()) as { path: string };
    expect(path).toBe(join(WS, ".agents", "skills", "deploy-notes", "SKILL.md"));
    expect(readFileSync(path, "utf8")).toContain("Step two, refined.");
  });

  it("refuses a relative workspace", async () => {
    expect((await req("POST", `/api/agent-skills/${AGENT}/skills/deploy-notes/export`, { root: "rel/dir" })).status).toBe(400);
  });

  it("rollback restores the previous version, then has nothing left to restore", async () => {
    const res = await req("POST", `/api/agent-skills/${AGENT}/skills/deploy-notes/rollback`);
    expect(res.status).toBe(200);
    const s = (await res.json()) as AgentSkillDto;
    expect(s.version).toBe(1);
    expect(s.instructions).toBe("Step one.\nStep two.");
    expect(s.versions.map((v) => v.version)).toEqual([1]);
    expect((await req("POST", `/api/agent-skills/${AGENT}/skills/deploy-notes/rollback`)).status).toBe(404);
    expect((await req("POST", `/api/agent-skills/${AGENT}/skills/unknown/rollback`)).status).toBe(404);
  });
});

describe("Cortex library → agent skills", () => {
  it("writes one-line, unquoted front matter (parseSKILLmd keeps quotes)", () => {
    expect(librarySkillMarkdown({ name: "n", description: "", content: "body" })).toBe("---\nname: n\ndescription: n\n---\n\nbody\n");
    expect(librarySkillMarkdown({ name: "n", description: "two\nlines", content: "b" })).toContain("description: two lines\n");
  });

  it("moves a library row into the agent (installed, locked) and out of the library", async () => {
    const id = cortexDb.prepare("INSERT INTO skills (name, description, content) VALUES (?, ?, ?)").run("triage", "Triage: bugs first", "Label, then reproduce.").lastInsertRowid;
    const res = await req("POST", `/api/agent-skills/${AGENT}/library/${id}`);
    expect(res.status).toBe(200);
    const s = (await res.json()) as AgentSkillDto;
    expect(s).toMatchObject({ name: "triage", source: "installed", evolutionMode: "locked" });
    expect(s.instructions).toContain("Label, then reproduce.");
    expect(cortexDb.prepare("SELECT id FROM skills WHERE id = ?").get(id)).toBeNull();
    expect((await listSkills()).some((x) => x.name === "triage")).toBe(true);
  });

  it("refuses to replace a skill the agent already has, and keeps the row", async () => {
    const id = cortexDb.prepare("INSERT INTO skills (name, description, content) VALUES (?, ?, ?)").run("triage", "again", "other").lastInsertRowid;
    expect((await req("POST", `/api/agent-skills/${AGENT}/library/${id}`)).status).toBe(409);
    expect(cortexDb.prepare("SELECT id FROM skills WHERE id = ?").get(id)).not.toBeNull();
    expect((await req("POST", `/api/agent-skills/${AGENT}/library/99999`)).status).toBe(404);
  });
});

describe("refine", () => {
  it("needs a model when the agent has no recorded run", async () => {
    expect((await req("POST", `/api/agent-skills/${AGENT}/refine`, {})).status).toBe(400);
    expect((await req("POST", `/api/agent-skills/${AGENT}/refine`, { provider: "nope" })).status).toBe(400);
  });

  it("runs on the agent's last recorded model over its own database", async () => {
    cortexDb
      .prepare("INSERT INTO cortex_runs (run_id, agent_id, started_at, provider, model) VALUES (?, ?, ?, ?, ?)")
      .run("run-r1", AGENT, Date.now(), "test", "test-model");
    const res = await req("POST", `/api/agent-skills/${AGENT}/refine`, {});
    expect(res.status).toBe(200);
    const r = (await res.json()) as Record<string, number>;
    expect(Object.keys(r).sort()).toEqual(["failed", "refined", "skipped", "unchanged"]);
    expect(refineCalls.at(-1)).toEqual({ provider: "test", model: "test-model", dbPath: dbPathOf(AGENT) });
    const listed = (await (await req("GET", `/api/agent-skills/${AGENT}`)).json()) as { refineWith: unknown };
    expect(listed.refineWith).toEqual({ provider: "test", model: "test-model" });
  });
});

describe("GET /api/agent-skills/:agentId/events", () => {
  it("returns lifecycle events newest first, linked to the run their taskId names", async () => {
    const ins = cortexDb.prepare("INSERT INTO cortex_events (agent_id, run_id, ts, type, payload) VALUES (?, ?, ?, ?, ?)");
    ins.run(AGENT, "run-r1", 10, "SkillActivated", JSON.stringify({ skillName: "deploy-notes", version: 2, trigger: "model", iteration: 1, confidence: "trusted" }));
    ins.run(AGENT, "chat-run", 20, "SkillPromoted", JSON.stringify({ skillName: "deploy-notes", fromConfidence: "tentative", toConfidence: "trusted", taskId: "run-r1" }));
    ins.run(AGENT, "run-r1", 30, "AgentStarted", JSON.stringify({}));
    ins.run(AGENT, "run-r1", 40, "SkillRefined", JSON.stringify({ skillName: "other", previousVersion: 1, newVersion: 2 }));
    ins.run("someone-else", "x", 50, "SkillRefined", JSON.stringify({ skillName: "deploy-notes", previousVersion: 1, newVersion: 2 }));

    const all = (await (await req("GET", `/api/agent-skills/${AGENT}/events`)).json()) as { events: { ts: number; runId: string; event: { _tag: string } }[] };
    expect(all.events.map((e) => e.event._tag)).toEqual(["SkillRefined", "SkillPromoted", "SkillActivated"]);
    const one = (await (await req("GET", `/api/agent-skills/${AGENT}/events?skill=deploy-notes`)).json()) as typeof all;
    expect(one.events.map((e) => [e.event._tag, e.runId])).toEqual([
      ["SkillPromoted", "run-r1"],
      ["SkillActivated", "run-r1"],
    ]);
  });
});
