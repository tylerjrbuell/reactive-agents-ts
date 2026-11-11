import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { Database } from "@reactive-agents/runtime-shim";
import {
  MemoryDatabase,
  MemoryDatabaseLive,
  MemorySearchService,
  MemorySearchServiceLive,
  ProceduralMemoryService,
  ProceduralMemoryServiceLive,
  SemanticMemoryService,
  SemanticMemoryServiceLive,
  provenanceFromSource,
} from "../src/index.js";
import type { MemoryId, ProceduralEntry, SemanticEntry } from "../src/types.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-memory-provenance";
const TEST_DB = path.join(TEST_DB_DIR, "provenance.db");

const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };

const layers = () => {
  const dbLayer = MemoryDatabaseLive(config);
  return Layer.mergeAll(
    SemanticMemoryServiceLive,
    ProceduralMemoryServiceLive,
    MemorySearchServiceLive,
  ).pipe(Layer.provideMerge(dbLayer));
};

const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    SemanticMemoryService | ProceduralMemoryService | MemorySearchService | MemoryDatabase
  >,
) => Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(layers()))));

const semantic = (id: string, content: string, extra: Partial<SemanticEntry> = {}): SemanticEntry => ({
  id: id as MemoryId,
  agentId: "test-agent",
  content,
  summary: content.slice(0, 50),
  importance: 0.5,
  verified: false,
  tags: ["t"],
  createdAt: new Date(),
  updatedAt: new Date(),
  accessCount: 0,
  lastAccessedAt: new Date(),
  ...extra,
});

const procedural = (id: string, extra: Partial<ProceduralEntry> = {}): ProceduralEntry => ({
  id: id as MemoryId,
  agentId: "test-agent",
  name: `wf-${id}`,
  description: "a workflow",
  pattern: "step1 -> step2",
  successRate: 0.5,
  useCount: 0,
  tags: ["wf"],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

const cleanup = () => {
  try {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
};

describe("memory provenance (task_id / run_id)", () => {
  afterEach(cleanup);

  it("migrates a pre-provenance database and keeps its rows", async () => {
    cleanup();
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    // Old schema: the tables exactly as they shipped before provenance columns.
    const old = new Database(TEST_DB, { create: true });
    old.exec(`
      CREATE TABLE semantic_memory (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, content TEXT NOT NULL,
        summary TEXT NOT NULL, importance REAL NOT NULL DEFAULT 0.5,
        verified INTEGER NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '[]',
        embedding BLOB, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0, last_accessed_at TEXT NOT NULL
      );
      CREATE TABLE procedural_memory (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, name TEXT NOT NULL,
        description TEXT NOT NULL, pattern TEXT NOT NULL,
        success_rate REAL NOT NULL DEFAULT 0, use_count INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE semantic_fts USING fts5(
        id UNINDEXED, content, tags, content='semantic_memory', content_rowid='rowid'
      );
      CREATE TRIGGER semantic_fts_insert AFTER INSERT ON semantic_memory BEGIN
        INSERT INTO semantic_fts(rowid, id, content, tags)
        VALUES (new.rowid, new.id, new.content, new.tags);
      END;
    `);
    const now = new Date().toISOString();
    old
      .prepare(
        `INSERT INTO semantic_memory (id, agent_id, content, summary, created_at, updated_at, last_accessed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("legacy-sem", "test-agent", "legacy zebra fact", "legacy", now, now, now);
    old
      .prepare(
        `INSERT INTO procedural_memory (id, agent_id, name, description, pattern, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("legacy-proc", "test-agent", "legacy-wf", "d", "p", now, now);
    old.close();

    const result = await run(
      Effect.gen(function* () {
        const db = yield* MemoryDatabase;
        const sem = yield* SemanticMemoryService;
        const proc = yield* ProceduralMemoryService;
        const cols = yield* db.query<{ name: string }>(`PRAGMA table_info(semantic_memory)`);
        const procCols = yield* db.query<{ name: string }>(`PRAGMA table_info(procedural_memory)`);
        const legacySem = yield* sem.get("legacy-sem" as MemoryId);
        const legacyProc = yield* proc.get("legacy-proc" as MemoryId);
        // New writes work on the migrated table, and FTS still indexes them.
        yield* sem.store(semantic("new-sem", "fresh zebra fact", { taskId: "task-9", runId: "run-9" }));
        // The FTS update trigger still fires on the altered table.
        yield* sem.update("legacy-sem" as MemoryId, { content: "legacy zebra fact revised" });
        const hits = yield* sem.search({ query: "zebra", agentId: "test-agent" });
        return {
          cols: cols.map((c) => c.name),
          procCols: procCols.map((c) => c.name),
          legacySem,
          legacyProc,
          hits,
        };
      }),
    );

    expect(result.cols).toContain("task_id");
    expect(result.cols).toContain("run_id");
    expect(result.procCols).toContain("task_id");
    expect(result.procCols).toContain("run_id");
    expect(result.legacySem.content).toBe("legacy zebra fact");
    expect(result.hits.find((h) => h.id === "legacy-sem")?.content).toBe("legacy zebra fact revised");
    expect(result.legacySem.taskId).toBeUndefined();
    expect(result.legacySem.runId).toBeUndefined();
    expect(result.legacyProc.name).toBe("legacy-wf");
    expect(result.legacyProc.taskId).toBeUndefined();
    expect(result.hits.map((h) => h.id).sort()).toEqual(["legacy-sem", "new-sem"]);
  });

  it("migration is idempotent across reopen", async () => {
    await run(
      SemanticMemoryService.pipe(
        Effect.flatMap((s) => s.store(semantic("a", "alpha", { taskId: "t1" }))),
      ),
    );
    const back = await run(
      SemanticMemoryService.pipe(Effect.flatMap((s) => s.get("a" as MemoryId))),
    );
    expect(back.taskId).toBe("t1");
  });

  it("stored semantic entry with source.taskId reads back task_id and run_id", async () => {
    const source = { type: "agent" as const, id: "agent-1", taskId: "task-42", runId: "run-7" };
    const result = await run(
      Effect.gen(function* () {
        const db = yield* MemoryDatabase;
        const sem = yield* SemanticMemoryService;
        yield* sem.store(semantic("s1", "provenance fact", provenanceFromSource(source)));
        const raw = yield* db.query<{ task_id: string | null; run_id: string | null }>(
          `SELECT task_id, run_id FROM semantic_memory WHERE id = ?`,
          ["s1"],
        );
        const entry = yield* sem.get("s1" as MemoryId);
        const listed = yield* sem.listByAgent("test-agent");
        return { raw: raw[0], entry, listed };
      }),
    );
    expect(result.raw).toEqual({ task_id: "task-42", run_id: "run-7" });
    expect(result.entry.taskId).toBe("task-42");
    expect(result.entry.runId).toBe("run-7");
    expect(result.listed[0]!.runId).toBe("run-7");
  });

  it("entries without provenance store NULL and omit the fields", async () => {
    const entry = await run(
      Effect.gen(function* () {
        const sem = yield* SemanticMemoryService;
        yield* sem.store(semantic("s2", "anonymous fact"));
        return yield* sem.get("s2" as MemoryId);
      }),
    );
    expect("taskId" in entry).toBe(false);
    expect("runId" in entry).toBe(false);
  });

  it("procedural entry round-trips provenance", async () => {
    const entry = await run(
      Effect.gen(function* () {
        const proc = yield* ProceduralMemoryService;
        yield* proc.store(procedural("p1", { taskId: "task-1", runId: "run-1" }));
        return yield* proc.get("p1" as MemoryId);
      }),
    );
    expect(entry.taskId).toBe("task-1");
    expect(entry.runId).toBe("run-1");
  });

  it("ProceduralMemoryService.delete removes the workflow", async () => {
    const result = await run(
      Effect.gen(function* () {
        const proc = yield* ProceduralMemoryService;
        yield* proc.store(procedural("p1"));
        yield* proc.store(procedural("p2"));
        yield* proc.delete("p1" as MemoryId);
        yield* proc.delete("missing" as MemoryId);
        const remaining = yield* proc.listActive("test-agent");
        const gone = yield* proc.get("p1" as MemoryId).pipe(
          Effect.map(() => "found"),
          Effect.catchTag("MemoryNotFoundError", () => Effect.succeed("not-found")),
        );
        return { remaining: remaining.map((e) => e.id), gone };
      }),
    );
    expect(result.remaining).toEqual(["p2" as MemoryId]);
    expect(result.gone).toBe("not-found");
  });

  it("LIKE fallback search (no FTS5, e.g. node:sqlite) filters by provenance", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const real = yield* MemoryDatabase;
          const sem = yield* SemanticMemoryService;
          yield* sem.store(semantic("l1", "fallback kiwi note", { runId: "rX" }));
          yield* sem.store(semantic("l2", "fallback kiwi memo", { runId: "rY" }));
          const likeLayer = SemanticMemoryServiceLive.pipe(
            Layer.provide(Layer.succeed(MemoryDatabase, { ...real, hasFTS5: false })),
          );
          return yield* SemanticMemoryService.pipe(
            Effect.flatMap((s) => s.search({ query: "kiwi", agentId: "test-agent", runId: "rY" })),
            Effect.provide(likeLayer),
          );
        }).pipe(Effect.provide(layers())),
      ),
    );
    expect(result.map((e) => e.id)).toEqual(["l2" as MemoryId]);
    expect(result[0]!.runId).toBe("rY");
  });

  it("semantic search finds short words ('bun', 'db')", async () => {
    const result = await run(
      Effect.gen(function* () {
        const sem = yield* SemanticMemoryService;
        yield* sem.store(semantic("b1", "the project runs on bun"));
        yield* sem.store(semantic("b2", "sqlite db file lives in tmp"));
        const bun = yield* sem.search({ query: "bun", agentId: "test-agent" });
        const db = yield* sem.search({ query: "db", agentId: "test-agent" });
        return { bun: bun.map((e) => e.id), db: db.map((e) => e.id) };
      }),
    );
    expect(result.bun).toEqual(["b1" as MemoryId]);
    expect(result.db).toEqual(["b2" as MemoryId]);
  });

  it("listByAgent and listActive filter by taskId / runId", async () => {
    const result = await run(
      Effect.gen(function* () {
        const sem = yield* SemanticMemoryService;
        const proc = yield* ProceduralMemoryService;
        yield* sem.store(semantic("f1", "one", { taskId: "tA", runId: "rA" }));
        yield* sem.store(semantic("f2", "two", { taskId: "tA", runId: "rB" }));
        yield* sem.store(semantic("f3", "three"));
        yield* proc.store(procedural("p1", { taskId: "tA", runId: "rA" }));
        yield* proc.store(procedural("p2", { taskId: "tB", runId: "rB" }));
        const ids = (xs: ReadonlyArray<{ id: MemoryId }>) => xs.map((x) => x.id).sort();
        return {
          semAll: ids(yield* sem.listByAgent("test-agent")),
          semTask: ids(yield* sem.listByAgent("test-agent", 100, { taskId: "tA" })),
          semRun: ids(yield* sem.listByAgent("test-agent", 100, { runId: "rB" })),
          semBoth: ids(yield* sem.listByAgent("test-agent", 100, { taskId: "tA", runId: "rA" })),
          procAll: ids(yield* proc.listActive("test-agent")),
          procRun: ids(yield* proc.listActive("test-agent", { runId: "rB" })),
          procTask: ids(yield* proc.listActive("test-agent", { taskId: "tA" })),
        };
      }),
    );
    expect(result.semAll).toEqual(["f1", "f2", "f3"] as MemoryId[]);
    expect(result.semTask).toEqual(["f1", "f2"] as MemoryId[]);
    expect(result.semRun).toEqual(["f2"] as MemoryId[]);
    expect(result.semBoth).toEqual(["f1"] as MemoryId[]);
    expect(result.procAll).toEqual(["p1", "p2"] as MemoryId[]);
    expect(result.procRun).toEqual(["p2"] as MemoryId[]);
    expect(result.procTask).toEqual(["p1"] as MemoryId[]);
  });

  it("semantic search returns provenance and filters by task/run", async () => {
    const result = await run(
      Effect.gen(function* () {
        const sem = yield* SemanticMemoryService;
        const search = yield* MemorySearchService;
        yield* sem.store(semantic("r1", "quantum widget notes", { taskId: "tA", runId: "rA" }));
        yield* sem.store(semantic("r2", "quantum widget errata", { taskId: "tB", runId: "rB" }));
        yield* sem.store(semantic("r3", "unrelated gardening", { taskId: "tA", runId: "rA" }));
        const all = yield* sem.search({ query: "quantum widget", agentId: "test-agent" });
        const byRun = yield* sem.search({ query: "quantum", agentId: "test-agent", runId: "rB" });
        const byTask = yield* sem.search({ query: "quantum", agentId: "test-agent", taskId: "tA" });
        const viaSearchService = yield* search.searchSemantic({
          query: "quantum",
          agentId: "test-agent",
          runId: "rA",
        });
        return { all, byRun, byTask, viaSearchService };
      }),
    );
    expect(result.all.map((e) => e.id).sort()).toEqual(["r1", "r2"]);
    const r1 = result.all.find((e) => e.id === "r1")!;
    expect(r1.taskId).toBe("tA");
    expect(r1.runId).toBe("rA");
    expect(result.byRun.map((e) => e.id)).toEqual(["r2" as MemoryId]);
    expect(result.byTask.map((e) => e.id)).toEqual(["r1" as MemoryId]);
    expect(result.viaSearchService.map((e) => e.id)).toEqual(["r1" as MemoryId]);
    expect(result.viaSearchService[0]!.runId).toBe("rA");
  });
});
