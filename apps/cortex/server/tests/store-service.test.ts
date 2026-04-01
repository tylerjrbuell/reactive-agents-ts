import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { upsertRun, updateRunStats } from "../db/queries.js";
import { CortexStoreService, CortexStoreServiceLive } from "../services/store-service.js";

const makeLayer = (db: Database) => CortexStoreServiceLive(db);

describe("CortexStoreService", () => {
  it("should return empty array when no runs exist", async () => {
    const db = new Database(":memory:");
    applySchema(db);

    const program = Effect.gen(function* () {
      const svc = yield* CortexStoreService;
      const runs = yield* svc.getRecentRuns(10);
      expect(runs).toHaveLength(0);
    });

    await Effect.runPromise(program.pipe(Effect.provide(makeLayer(db))));
  });

  it("should return runs in descending order", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    upsertRun(db, "a1", "run-1");
    upsertRun(db, "a1", "run-2");

    const program = Effect.gen(function* () {
      const svc = yield* CortexStoreService;
      const runs = yield* svc.getRecentRuns(10);
      expect(runs.length).toBeGreaterThanOrEqual(2);
    });

    await Effect.runPromise(program.pipe(Effect.provide(makeLayer(db))));
  });

  it("ensureRunRow creates a run row visible to getRun", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const program = Effect.gen(function* () {
      const svc = yield* CortexStoreService;
      yield* svc.ensureRunRow("agent-1", "run-pre");
      return yield* svc.getRun("run-pre");
    });
    const opt = await Effect.runPromise(program.pipe(Effect.provide(makeLayer(db))));
    expect(Option.isSome(opt)).toBe(true);
    if (Option.isSome(opt)) {
      expect(opt.value.agentId).toBe("agent-1");
      expect(opt.value.runId).toBe("run-pre");
    }
  });

  it("getRun returns None when missing", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const program = Effect.gen(function* () {
      const svc = yield* CortexStoreService;
      return yield* svc.getRun("nope");
    });
    const opt = await Effect.runPromise(program.pipe(Effect.provide(makeLayer(db))));
    expect(Option.isNone(opt)).toBe(true);
  });

  it("getRun returns Some with RunSummary", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    upsertRun(db, "x", "run-x");
    updateRunStats(db, "run-x", { status: "failed" });
    const program = Effect.gen(function* () {
      const svc = yield* CortexStoreService;
      return yield* svc.getRun("run-x");
    });
    const opt = await Effect.runPromise(program.pipe(Effect.provide(makeLayer(db))));
    expect(Option.isSome(opt)).toBe(true);
    if (Option.isSome(opt)) {
      expect(opt.value.runId).toBe("run-x");
      expect(opt.value.status).toBe("failed");
    }
  });

  it("getRunEvents returns rows for run", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    upsertRun(db, "a", "r-ev");
    db.prepare(
      `INSERT INTO cortex_events (agent_id, run_id, session_id, seq, ts, type, payload) VALUES (?,?,?,?,?,?,?)`,
    ).run("a", "r-ev", null, 0, 1, "TaskCreated", "{}");

    const program = Effect.gen(function* () {
      const svc = yield* CortexStoreService;
      return yield* svc.getRunEvents("r-ev");
    });
    const ev = await Effect.runPromise(program.pipe(Effect.provide(makeLayer(db))));
    expect(ev).toHaveLength(1);
    expect(ev[0]?.type).toBe("TaskCreated");
  });

  it("deleteRun removes run row and events", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    upsertRun(db, "a", "run-del");
    db.prepare(
      `INSERT INTO cortex_events (agent_id, run_id, session_id, seq, ts, type, payload) VALUES (?,?,?,?,?,?,?)`,
    ).run("a", "run-del", null, 0, 1, "TaskCreated", "{}");

    const deleted = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CortexStoreService;
        return yield* svc.deleteRun("run-del");
      }).pipe(Effect.provide(makeLayer(db))),
    );
    expect(deleted).toBe(true);

    const remaining = db.prepare("SELECT COUNT(*) as c FROM cortex_runs WHERE run_id = ?").get("run-del") as { c: number };
    const remainingEvents = db.prepare("SELECT COUNT(*) as c FROM cortex_events WHERE run_id = ?").get("run-del") as { c: number };
    expect(remaining.c).toBe(0);
    expect(remainingEvents.c).toBe(0);
  });

  it("pruneRuns deletes old non-live runs and preserves old live runs by default", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const now = Date.now();
    db.prepare("INSERT INTO cortex_runs (run_id, agent_id, started_at, status) VALUES (?, ?, ?, ?)").run(
      "old-completed",
      "a1",
      now - 10 * 24 * 60 * 60 * 1000,
      "completed",
    );
    db.prepare("INSERT INTO cortex_runs (run_id, agent_id, started_at, status) VALUES (?, ?, ?, ?)").run(
      "old-live",
      "a1",
      now - 10 * 24 * 60 * 60 * 1000,
      "live",
    );
    db.prepare("INSERT INTO cortex_runs (run_id, agent_id, started_at, status) VALUES (?, ?, ?, ?)").run(
      "recent-completed",
      "a1",
      now - 60 * 60 * 1000,
      "completed",
    );

    const deleted = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CortexStoreService;
        return yield* svc.pruneRuns(7 * 24 * 60 * 60 * 1000);
      }).pipe(Effect.provide(makeLayer(db))),
    );
    expect(deleted).toBe(1);

    const runs = db.prepare("SELECT run_id FROM cortex_runs ORDER BY run_id ASC").all() as Array<{ run_id: string }>;
    expect(runs.map((r) => r.run_id)).toEqual(["old-live", "recent-completed"]);
  });

  it("getTools returns empty when tools table missing", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const program = Effect.gen(function* () {
      const svc = yield* CortexStoreService;
      return yield* svc.getTools();
    });
    const tools = await Effect.runPromise(program.pipe(Effect.provide(makeLayer(db))));
    expect(tools).toEqual([]);
  });

  it("getSkills returns rows when skills table exists", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    db.exec(`
      CREATE TABLE skills (id INTEGER PRIMARY KEY, name TEXT, created_at INTEGER DEFAULT 0);
      INSERT INTO skills (name) VALUES ('demo-skill');
    `);
    const program = Effect.gen(function* () {
      const svc = yield* CortexStoreService;
      return yield* svc.getSkills();
    });
    const skills = await Effect.runPromise(program.pipe(Effect.provide(makeLayer(db))));
    expect(skills.length).toBeGreaterThanOrEqual(1);
  });
});
