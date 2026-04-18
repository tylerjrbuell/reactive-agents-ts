import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema, enforceRetention } from "../db/schema.js";
import {
  insertEvent,
  upsertRun,
  getRecentRuns,
  getNextSeq,
  updateRunStats,
  getRunById,
  getRunEvents,
} from "../db/queries.js";

describe("CortexDB schema + queries", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
  });

  it("should create all required tables", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("cortex_events");
    expect(names).toContain("cortex_runs");
    expect(names).toContain("cortex_agents");
    expect(names).toContain("cortex_chat_sessions");
    expect(names).toContain("cortex_chat_turns");
  });

  it("should insert and retrieve events", () => {
    upsertRun(db, "agent-1", "run-1");
    insertEvent(
      db,
      {
        v: 1,
        agentId: "agent-1",
        runId: "run-1",
        event: {
          _tag: "AgentStarted",
          taskId: "t1",
          agentId: "agent-1",
          provider: "anthropic",
          model: "test",
          timestamp: Date.now(),
        },
      },
      0,
    );

    const events = db.prepare("SELECT * FROM cortex_events WHERE run_id = 'run-1'").all();
    expect(events).toHaveLength(1);
  });

  it("should auto-increment sequence numbers", () => {
    upsertRun(db, "agent-1", "run-1");
    const seq0 = getNextSeq(db, "run-1");
    expect(seq0).toBe(0);

    insertEvent(
      db,
      { v: 1, agentId: "agent-1", runId: "run-1", event: { _tag: "TaskCreated", taskId: "t1" } },
      seq0,
    );
    const seq1 = getNextSeq(db, "run-1");
    expect(seq1).toBe(1);
  });

  it("should map getRecentRuns to RunSummary", () => {
    upsertRun(db, "a", "r1");
    const runs = getRecentRuns(db, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runId).toBe("r1");
    expect(runs[0]?.agentId).toBe("a");
    expect(runs[0]?.hasDebrief).toBe(false);
  });

  it("getRunById includes displayName from display_name column", () => {
    upsertRun(db, "a", "r-lbl", "My beacon run");
    const s = getRunById(db, "r-lbl");
    expect(s?.displayName).toBe("My beacon run");
  });

  it("getRunById resolves displayName from cortex_agents when display_name empty", () => {
    db.prepare("INSERT INTO cortex_agents (agent_id, name, config, status) VALUES (?, ?, ?, ?)").run(
      "ag-join",
      "Saved agent title",
      "{}",
      "active",
    );
    upsertRun(db, "ag-join", "r-join");
    const s = getRunById(db, "r-join");
    expect(s?.displayName).toBe("Saved agent title");
    expect(s?.agentRecordName).toBe("Saved agent title");
  });

  it("getRunById returns agentRecordName from join when run has its own display_name", () => {
    db.prepare("INSERT INTO cortex_agents (agent_id, name, config, status) VALUES (?, ?, ?, ?)").run(
      "ag-dual",
      "Saved profile",
      "{}",
      "active",
    );
    upsertRun(db, "ag-dual", "r-dual", "Launch label");
    const s = getRunById(db, "r-dual");
    expect(s?.displayName).toBe("Launch label");
    expect(s?.agentRecordName).toBe("Saved profile");
  });

  it("updateRunStats is a no-op when patch is empty", () => {
    upsertRun(db, "a", "r1");
    updateRunStats(db, "r1", {});
    const row = db.prepare("SELECT iteration_count, tokens_used FROM cortex_runs WHERE run_id = 'r1'").get() as {
      iteration_count: number;
      tokens_used: number;
    };
    expect(row.iteration_count).toBe(0);
    expect(row.tokens_used).toBe(0);
  });

  it("updateRunStats applies tokens, cost, status, debrief, completedAt", () => {
    upsertRun(db, "a", "r1");
    updateRunStats(db, "r1", {
      iterationCount: 3,
      tokensUsed: 900,
      cost: 0.01,
      status: "completed",
      debrief: '{"summary":"ok"}',
      completedAt: 42,
    });
    const row = db
      .prepare(
        "SELECT iteration_count, tokens_used, cost_usd, status, debrief, completed_at FROM cortex_runs WHERE run_id = 'r1'",
      )
      .get() as {
      iteration_count: number;
      tokens_used: number;
      cost_usd: number;
      status: string;
      debrief: string;
      completed_at: number;
    };
    expect(row.iteration_count).toBe(3);
    expect(row.tokens_used).toBe(900);
    expect(row.cost_usd).toBeCloseTo(0.01);
    expect(row.status).toBe("completed");
    expect(row.debrief).toContain("summary");
    expect(row.completed_at).toBe(42);
  });

  it("getRunById returns null for missing run", () => {
    expect(getRunById(db, "missing")).toBeNull();
  });

  it("getRunById maps row including completedAt and hasDebrief", () => {
    upsertRun(db, "ag", "run-z");
    updateRunStats(db, "run-z", { completedAt: 99, debrief: "{}" });
    const summary = getRunById(db, "run-z");
    expect(summary).not.toBeNull();
    expect(summary!.completedAt).toBe(99);
    expect(summary!.hasDebrief).toBe(true);
  });

  it("getRunEvents returns rows ordered by seq", () => {
    upsertRun(db, "a", "r-seq");
    insertEvent(db, { v: 1, agentId: "a", runId: "r-seq", event: { _tag: "TaskCreated", taskId: "t" } }, 0);
    insertEvent(
      db,
      { v: 1, agentId: "a", runId: "r-seq", event: { _tag: "AgentCompleted", taskId: "t", agentId: "a", success: true, totalIterations: 1, totalTokens: 1, durationMs: 1 } },
      1,
    );
    const ev = getRunEvents(db, "r-seq");
    expect(ev.map((e) => e.type)).toEqual(["TaskCreated", "AgentCompleted"]);
  });

  it("stores session_id when provided on ingest-shaped insert", () => {
    upsertRun(db, "a", "r-s");
    insertEvent(
      db,
      {
        v: 1,
        agentId: "a",
        runId: "r-s",
        sessionId: "sess-1",
        event: { _tag: "TaskCreated", taskId: "t" },
      },
      0,
    );
    const sid = (
      db.prepare("SELECT session_id FROM cortex_events WHERE run_id = 'r-s'").get() as { session_id: string }
    ).session_id;
    expect(sid).toBe("sess-1");
  });

  it("getRecentRuns respects limit", () => {
    for (let i = 0; i < 5; i++) upsertRun(db, "a", `r${i}`);
    expect(getRecentRuns(db, 3)).toHaveLength(3);
  });

  it("enforceRetention keeps 50 newest runs per agent and deletes older events", () => {
    const agent = "retain-me";
    for (let i = 0; i < 51; i++) {
      const runId = `run-${i}`;
      db.prepare(`INSERT INTO cortex_runs (run_id, agent_id, started_at) VALUES (?, ?, ?)`).run(
        runId,
        agent,
        i,
      );
      insertEvent(
        db,
        { v: 1, agentId: agent, runId, event: { _tag: "TaskCreated", taskId: "t" } },
        0,
      );
    }
    enforceRetention(db, agent);
    const runCount = (db.prepare("SELECT COUNT(*) as c FROM cortex_runs WHERE agent_id = ?").get(agent) as {
      c: number;
    }).c;
    expect(runCount).toBe(50);
    const evForOldest = getRunEvents(db, "run-0");
    expect(evForOldest).toHaveLength(0);
  });

  it("enforceRetention does nothing when at most 50 runs", () => {
    upsertRun(db, "b", "only");
    enforceRetention(db, "b");
    expect(getRunById(db, "only")).not.toBeNull();
  });

  it("cortex_chat_sessions has stable_agent_id column after migration", () => {
    const db2 = new Database(":memory:");
    db2.exec(`
      CREATE TABLE IF NOT EXISTS cortex_chat_sessions (
        session_id   TEXT PRIMARY KEY,
        name         TEXT    NOT NULL DEFAULT 'New Chat',
        agent_config TEXT    NOT NULL,
        created_at   INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER NOT NULL DEFAULT 0
      )
    `);
    applySchema(db2);
    const cols = (db2.prepare("PRAGMA table_info(cortex_chat_sessions)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toContain("stable_agent_id");
  });
});
