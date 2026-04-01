import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { applySchema } from "../db/schema.js";
import { upsertRun, updateRunStats } from "../db/queries.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexRunnerService } from "../services/runner-service.js";
import { runsRouter } from "../api/runs.js";

const mockRunnerLayer = Layer.succeed(CortexRunnerService, {
  start: () =>
    Effect.succeed({ agentId: "test-runner-agent", runId: "01HZTEST000000000000000000" }),
  pause: () => Effect.void,
  stop: () => Effect.void,
  getActive: () => Effect.succeed(new Map()),
});

function appWithRunsDb(db: Database) {
  applySchema(db);
  return new Elysia().use(runsRouter(CortexStoreServiceLive(db), mockRunnerLayer));
}

describe("POST /api/runs", () => {
  it("returns 200 and agentId from runner", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    const res = await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hello", provider: "anthropic", tools: ["web-search"] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agentId: string; runId: string };
    expect(body.agentId).toBe("test-runner-agent");
    expect(body.runId).toBe("01HZTEST000000000000000000");
  });
});

describe("GET /api/runs", () => {
  it("returns empty array when no runs", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    const res = await app.handle(new Request("http://localhost/api/runs"));
    const body = (await res.json()) as unknown;
    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  it("returns run summaries newest first", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    db.prepare(`INSERT INTO cortex_runs (run_id, agent_id, started_at) VALUES ('old', 'a', 1)`).run();
    db.prepare(`INSERT INTO cortex_runs (run_id, agent_id, started_at) VALUES ('new', 'a', 99)`).run();

    const res = await app.handle(new Request("http://localhost/api/runs"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ runId: string }>;
    expect(body[0]?.runId).toBe("new");
    expect(body[1]?.runId).toBe("old");
  });

  it("GET /api/runs/:runId returns 404 when missing", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    const res = await app.handle(new Request("http://localhost/api/runs/missing-id"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Run not found");
  });

  it("GET /api/runs/:runId returns summary when present", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    upsertRun(db, "ag", "present-run");
    updateRunStats(db, "present-run", { status: "completed" });

    const res = await app.handle(new Request("http://localhost/api/runs/present-run"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; status: string };
    expect(body.runId).toBe("present-run");
    expect(body.status).toBe("completed");
  });

  it("GET /api/runs/:runId/events returns event rows", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    upsertRun(db, "a", "r-ev");
    db.prepare(
      `INSERT INTO cortex_events (agent_id, run_id, session_id, seq, ts, type, payload) VALUES (?,?,?,?,?,?,?)`,
    ).run("a", "r-ev", null, 0, 1, "TaskCreated", '{"taskId":"t"}');

    const res = await app.handle(new Request("http://localhost/api/runs/r-ev/events"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ type: string; payload: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.type).toBe("TaskCreated");
  });

  it("DELETE /api/runs/:runId removes run and returns ok", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    upsertRun(db, "a", "run-delete");

    const res = await app.handle(
      new Request("http://localhost/api/runs/run-delete", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deleted: number };
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(1);
  });

  it("POST /api/runs/prune deletes stale rows", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    const now = Date.now();
    db.prepare("INSERT INTO cortex_runs (run_id, agent_id, started_at, status) VALUES (?, ?, ?, ?)").run(
      "very-old",
      "a",
      now - 20 * 24 * 60 * 60 * 1000,
      "completed",
    );

    const res = await app.handle(
      new Request("http://localhost/api/runs/prune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ olderThanHours: 24 * 7 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deleted: number };
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(1);
  });
});
