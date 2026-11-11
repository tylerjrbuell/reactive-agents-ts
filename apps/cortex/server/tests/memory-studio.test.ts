// Run: bun test apps/cortex/server/tests/memory-studio.test.ts --timeout 15000
//
// Memory studio API (api/memory.ts + services/memory-inspector.ts):
//   - reads, search, edit and delete go through agent.memory() against the
//     database the framework resolves for the agent id (here a scratch path);
//   - `runId` narrows the listing to what that run wrote (provenance);
//   - an agent with no database is unavailable and no database is created;
//   - the router never opens memory.db itself.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMemoryLayer,
  EpisodicMemoryService,
  MemoryIdSchema,
  ProceduralMemoryService,
  SemanticMemoryService,
} from "@reactive-agents/memory";
import { applySchema } from "../db/schema.js";
import { memoryRouter } from "../api/memory.js";
import { isSafeAgentId, listingForRun, MemoryInspector, type MemoryListing } from "../services/memory-inspector.js";

const BASE = mkdtempSync(join(tmpdir(), "cortex-memory-studio-"));
const dbPathOf = (agentId: string): string => join(BASE, agentId, "memory.db");
const AGENT = "agent-mem";

const inspector = new MemoryInspector(dbPathOf);
const cortexDb = new Database(":memory:");
applySchema(cortexDb);
const app = memoryRouter(inspector, cortexDb);

const req = (method: string, path: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    }),
  );

beforeAll(async () => {
  mkdirSync(join(BASE, AGENT), { recursive: true });
  const now = new Date();
  const sem = (id: string, content: string, runId?: string) => ({
    id: MemoryIdSchema.make(id),
    agentId: AGENT,
    content,
    summary: content.slice(0, 30),
    importance: 0.7,
    verified: false,
    tags: ["seed"],
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    lastAccessedAt: now,
    ...(runId ? { taskId: `task-${runId}`, runId } : {}),
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const s = yield* SemanticMemoryService;
      yield* s.store(sem("sem-a", "The deploy uses blue green switching.", "run-1"));
      yield* s.store(sem("sem-b", "Prefer bun over npm in this repo.", "run-2"));
      yield* s.store(sem("sem-c", "Legacy fact without provenance."));
      const p = yield* ProceduralMemoryService;
      yield* p.store({
        id: MemoryIdSchema.make("proc-a"),
        agentId: AGENT,
        name: "release-steps",
        description: "How to cut a release",
        pattern: "build, test, tag",
        successRate: 0.9,
        useCount: 3,
        tags: [],
        createdAt: now,
        updatedAt: now,
        taskId: "task-run-1",
        runId: "run-1",
      });
      const e = yield* EpisodicMemoryService;
      yield* e.log({
        id: MemoryIdSchema.make("ep-a"),
        agentId: AGENT,
        date: now.toISOString().slice(0, 10),
        content: "Task started",
        taskId: "task-run-1",
        eventType: "task-started",
        createdAt: now,
      });
    }).pipe(Effect.provide(createMemoryLayer("1", { agentId: AGENT, dbPath: dbPathOf(AGENT) }))),
  );
  cortexDb.prepare("INSERT INTO cortex_runs (run_id, agent_id, started_at, display_name) VALUES (?, ?, ?, ?)").run(
    "run-1",
    AGENT,
    1,
    "Deploy notes",
  );
}, 30000);

afterAll(async () => {
  await inspector.disposeAll();
  cortexDb.close();
  rmSync(BASE, { recursive: true, force: true });
});

describe("memory studio API", () => {
  it("lists an agent's semantic, procedural and episodic memory with provenance", async () => {
    const res = await req("GET", `/api/memory/${AGENT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as MemoryListing;
    expect(body.available).toBe(true);
    expect(body.semantic.map((e) => e.id).sort()).toEqual(["sem-a", "sem-b", "sem-c"]);
    expect(body.semantic.find((e) => e.id === "sem-a")?.runId).toBe("run-1");
    expect(body.semantic.find((e) => e.id === "sem-c")?.runId).toBeUndefined();
    expect(body.procedural[0]?.name).toBe("release-steps");
    expect(body.episodic[0]?.taskId).toBe("task-run-1");
  }, 30000);

  it("runId narrows the listing to what that run wrote", async () => {
    const body = (await (await req("GET", `/api/memory/${AGENT}?runId=run-1`)).json()) as MemoryListing;
    expect(body.semantic.map((e) => e.id)).toEqual(["sem-a"]);
    expect(body.procedural.map((e) => e.id)).toEqual(["proc-a"]);
    expect(body.episodic.map((e) => e.id)).toEqual(["ep-a"]);
  }, 30000);

  it("runId filters in the store query, before the list limit", async () => {
    // One entry per layer: without the store-side filter a run's entry could be cut
    // off by another run's, and at most one of these two could pass.
    const tight = new MemoryInspector(dbPathOf, { semantic: 1, procedural: 1, episodic: 200 });
    try {
      const run1 = await tight.list(AGENT, { runId: "run-1" });
      const run2 = await tight.list(AGENT, { runId: "run-2" });
      expect(run1.ok && run1.value.semantic.map((e) => e.id)).toEqual(["sem-a"]);
      expect(run2.ok && run2.value.semantic.map((e) => e.id)).toEqual(["sem-b"]);
    } finally {
      await tight.disposeAll();
    }
  }, 30000);

  it("searches semantic memory, optionally within one run", async () => {
    // Short words count: the framework's FTS query keeps terms of 2+ characters.
    const short = (await (await req("GET", `/api/memory/${AGENT}/search?q=bun`)).json()) as { results: { id: string }[] };
    expect(short.results.map((r) => r.id)).toEqual(["sem-b"]);
    const all = (await (await req("GET", `/api/memory/${AGENT}/search?q=prefer`)).json()) as { results: { id: string }[] };
    expect(all.results.map((r) => r.id)).toEqual(["sem-b"]);
    const scoped = (await (await req("GET", `/api/memory/${AGENT}/search?q=prefer&runId=run-1`)).json()) as {
      results: unknown[];
    };
    expect(scoped.results).toEqual([]);
  }, 30000);

  it("edits and deletes semantic entries", async () => {
    const res = await req("PATCH", `/api/memory/${AGENT}/semantic/sem-b`, { content: "Prefer bun everywhere.", importance: 0.95 });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { content: string; importance: number; runId?: string };
    expect(updated.content).toBe("Prefer bun everywhere.");
    expect(updated.importance).toBe(0.95);
    expect(updated.runId).toBe("run-2");

    expect((await req("PATCH", `/api/memory/${AGENT}/semantic/nope`, { content: "x" })).status).toBe(404);
    expect((await req("PATCH", `/api/memory/${AGENT}/semantic/sem-b`, { importance: 2 })).status).toBe(422);

    expect((await req("DELETE", `/api/memory/${AGENT}/semantic/sem-c`)).status).toBe(200);
    const after = (await (await req("GET", `/api/memory/${AGENT}`)).json()) as MemoryListing;
    expect(after.semantic.map((e) => e.id).sort()).toEqual(["sem-a", "sem-b"]);
  }, 30000);

  it("edits and deletes procedural entries, keeping provenance", async () => {
    const res = await req("PATCH", `/api/memory/${AGENT}/procedural/proc-a`, { description: "Release checklist" });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { description: string; runId?: string };
    expect(updated.description).toBe("Release checklist");
    expect(updated.runId).toBe("run-1");
    expect((await req("DELETE", `/api/memory/${AGENT}/procedural/proc-a`)).status).toBe(200);
    const after = (await (await req("GET", `/api/memory/${AGENT}`)).json()) as MemoryListing;
    expect(after.procedural).toEqual([]);
  }, 30000);

  it("an agent without a database is unavailable, and looking creates none", async () => {
    const body = (await (await req("GET", "/api/memory/agent-none")).json()) as MemoryListing;
    expect(body.available).toBe(false);
    expect(existsSync(dbPathOf("agent-none"))).toBe(false);
    expect((await req("GET", "/api/memory/agent-none/search?q=x")).status).toBe(404);
    expect((await req("DELETE", "/api/memory/agent-none/semantic/x")).status).toBe(404);
  }, 30000);

  it("refuses agent ids that would escape the memory root", async () => {
    expect(isSafeAgentId("..")).toBe(false);
    expect(isSafeAgentId("a/b")).toBe(false);
    expect(isSafeAgentId("a\\b")).toBe(false);
    expect(isSafeAgentId("")).toBe(false);
    expect(isSafeAgentId("cortex-chat-01HX")).toBe(true);
    const body = (await (await req("GET", `/api/memory/${encodeURIComponent("../x")}`)).json()) as MemoryListing;
    expect(body.available).toBe(false);
  });

  it("the router never opens a memory database itself", () => {
    const src = readFileSync(join(import.meta.dir, "../api/memory.ts"), "utf8");
    expect(src).not.toMatch(/new Database\(/);
    expect(src).not.toContain("memory.db");
  });
});

describe("listingForRun", () => {
  it("matches episodic entries by the run id or a task id the run's entries recorded", () => {
    const listing: MemoryListing = {
      agentId: "a",
      available: true,
      dbPath: "",
      semantic: [
        { id: "s1", content: "", summary: "", importance: 0.5, verified: false, tags: [], createdAt: "", updatedAt: "", accessCount: 0, lastAccessedAt: "", taskId: "t1", runId: "r1" },
        { id: "s2", content: "", summary: "", importance: 0.5, verified: false, tags: [], createdAt: "", updatedAt: "", accessCount: 0, lastAccessedAt: "", runId: "r2" },
      ],
      procedural: [],
      episodic: [
        { id: "e1", date: "", content: "", eventType: "task-started", taskId: "t1" },
        { id: "e2", date: "", content: "", eventType: "task-started", taskId: "r1" },
        { id: "e3", date: "", content: "", eventType: "task-started", taskId: "t9" },
        { id: "e4", date: "", content: "", eventType: "task-started" },
      ],
    };
    const r = listingForRun(listing, "r1");
    expect(r.semantic.map((e) => e.id)).toEqual(["s1"]);
    expect(r.episodic.map((e) => e.id)).toEqual(["e1", "e2"]);
  });
});
