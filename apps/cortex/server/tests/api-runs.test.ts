import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { Effect, Layer, Ref } from "effect";
import { applySchema } from "../db/schema.js";
import { upsertRun, updateRunStats } from "../db/queries.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexRunnerService, type LaunchParams } from "../services/runner-service.js";
import { runsRouter } from "../api/runs.js";

const mockRunnerLayer = Layer.succeed(CortexRunnerService, {
  start: () =>
    Effect.succeed({ agentId: "test-runner-agent", runId: "01HZTEST000000000000000000" }),
  pause: () => Effect.void,
  stop: () => Effect.void,
  getActive: () => Effect.succeed(new Map()),
});

/** Creates a mock runner that captures the LaunchParams passed to start(). */
function captureRunnerLayer(captured: { params: LaunchParams | null }) {
  return Layer.succeed(CortexRunnerService, {
    start: (params) => {
      captured.params = params;
      return Effect.succeed({ agentId: "cap-agent", runId: "cap-run" });
    },
    pause: () => Effect.void,
    stop: () => Effect.void,
    getActive: () => Effect.succeed(new Map()),
  });
}

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

describe("POST /api/runs — expanded launch params", () => {
  function makeCapApp(db: Database, captured: { params: LaunchParams | null }) {
    applySchema(db);
    return new Elysia().use(runsRouter(CortexStoreServiceLive(db), captureRunnerLayer(captured)));
  }

  it("passes basic prompt and provider to runner", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    const app = makeCapApp(db, captured);

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Hello world", provider: "anthropic", model: "claude-sonnet-4-6" }),
      }),
    );

    expect(captured.params?.prompt).toBe("Hello world");
    expect(captured.params?.provider).toBe("anthropic");
    expect(captured.params?.model).toBe("claude-sonnet-4-6");
  });

  it("passes strategy and iteration controls to runner", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    const app = makeCapApp(db, captured);

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Run",
          strategy: "plan-execute-reflect",
          maxIterations: 15,
          minIterations: 3,
          temperature: 0.4,
          maxTokens: 2000,
        }),
      }),
    );

    expect(captured.params?.strategy).toBe("plan-execute-reflect");
    expect(captured.params?.maxIterations).toBe(15);
    expect(captured.params?.minIterations).toBe(3);
    expect(captured.params?.temperature).toBe(0.4);
    expect(captured.params?.maxTokens).toBe(2000);
  });

  it("passes systemPrompt and agentName to runner", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    const app = makeCapApp(db, captured);

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Go",
          systemPrompt: "You are a helpful assistant",
          agentName: "my-agent",
        }),
      }),
    );

    expect(captured.params?.systemPrompt).toBe("You are a helpful assistant");
    expect(captured.params?.agentName).toBe("my-agent");
  });

  it("passes execution controls: timeout, cacheTimeout, progressCheckpoint", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    const app = makeCapApp(db, captured);

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Go",
          timeout: 30000,
          cacheTimeout: 3600000,
          progressCheckpoint: 5,
        }),
      }),
    );

    expect(captured.params?.timeout).toBe(30000);
    expect(captured.params?.cacheTimeout).toBe(3600000);
    expect(captured.params?.progressCheckpoint).toBe(5);
  });

  it("passes retryPolicy to runner", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    const app = makeCapApp(db, captured);

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Go",
          retryPolicy: { enabled: true, maxRetries: 3, backoffMs: 2000 },
        }),
      }),
    );

    expect(captured.params?.retryPolicy?.maxRetries).toBe(3);
    expect(captured.params?.retryPolicy?.backoffMs).toBe(2000);
  });

  it("passes metaTools config to runner", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    const app = makeCapApp(db, captured);

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Go",
          metaTools: { enabled: true, brief: true, find: true, pulse: false, recall: true, harnessSkill: false },
        }),
      }),
    );

    expect(captured.params?.metaTools?.enabled).toBe(true);
    expect(captured.params?.metaTools?.brief).toBe(true);
    expect(captured.params?.metaTools?.find).toBe(true);
    expect(captured.params?.metaTools?.recall).toBe(true);
  });

  it("passes fallbacks config to runner", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    const app = makeCapApp(db, captured);

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Go",
          fallbacks: { enabled: true, providers: ["anthropic", "openai"], errorThreshold: 2 },
        }),
      }),
    );

    expect(captured.params?.fallbacks?.providers).toEqual(["anthropic", "openai"]);
    expect(captured.params?.fallbacks?.errorThreshold).toBe(2);
  });

  it("passes verificationStep to runner", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    const app = makeCapApp(db, captured);

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Go", verificationStep: "reflect" }),
      }),
    );

    expect(captured.params?.verificationStep).toBe("reflect");
  });
});

describe("POST /api/runs/:runId/recompute-stats", () => {
  it("returns 404 when run does not exist", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);

    const res = await app.handle(
      new Request("http://localhost/api/runs/no-such-run/recompute-stats", { method: "POST" }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not found");
  });

  it("returns ok when run exists and has events", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    upsertRun(db, "a", "stat-run");
    db.prepare(
      `INSERT INTO cortex_events (agent_id, run_id, session_id, seq, ts, type, payload) VALUES (?,?,?,?,?,?,?)`,
    ).run("a", "stat-run", null, 0, Date.now(), "AgentCompleted", JSON.stringify({ _tag: "AgentCompleted", totalTokens: 100, cost: 0.001 }));

    const res = await app.handle(
      new Request("http://localhost/api/runs/stat-run/recompute-stats", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
