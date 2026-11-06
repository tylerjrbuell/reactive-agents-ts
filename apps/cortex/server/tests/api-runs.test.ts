import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { Effect, Layer, Ref } from "effect";
import { applySchema } from "../db/schema.js";
import { upsertRun, updateRunStats } from "../db/queries.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexRunnerService, type LaunchParams } from "../services/runner-service.js";
import { CortexIngestService, CortexIngestServiceLive } from "../services/ingest-service.js";
import { CortexEventBridgeLive } from "../services/event-bridge.js";
import type { AgentEvent } from "@reactive-agents/core";
import { runsRouter } from "../api/runs.js";

const mockRunnerLayer = Layer.succeed(CortexRunnerService, {
  start: () =>
    Effect.succeed({ agentId: "test-runner-agent", runId: "01HZTEST000000000000000000" }),
  pause: () => Effect.void,
  resume: () => Effect.void,
  stop: () => Effect.void,
  terminate: () => Effect.void,
  getActive: () => Effect.succeed(new Map()),
  listPendingApprovals: () => Effect.succeed([]),
  approveApproval: () => Effect.void,
  denyApproval: () => Effect.void,
  listPendingInteractions: () => Effect.succeed([]),
  respondToInteraction: () => Effect.succeed({ success: true, output: "" }),
});

/** Creates a mock runner that captures the LaunchParams passed to start(). */
function captureRunnerLayer(captured: { params: LaunchParams | null }) {
  return Layer.succeed(CortexRunnerService, {
    start: (params) => {
      captured.params = params;
      return Effect.succeed({ agentId: "cap-agent", runId: "cap-run" });
    },
    pause: () => Effect.void,
    resume: () => Effect.void,
    stop: () => Effect.void,
    terminate: () => Effect.void,
    getActive: () => Effect.succeed(new Map()),
    listPendingApprovals: () => Effect.succeed([]),
    approveApproval: () => Effect.void,
    denyApproval: () => Effect.void,
    listPendingInteractions: () => Effect.succeed([]),
    respondToInteraction: () => Effect.succeed({ success: true, output: "" }),
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

  it("GET /api/runs/:runId returns the launch config snapshot (D1)", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    upsertRun(db, "ag", "snap-run", "Snap Run", JSON.stringify({ prompt: "hi", strategy: "blueprint", provider: "test" }));

    const res = await app.handle(new Request("http://localhost/api/runs/snap-run"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { launchParams?: { strategy?: string; prompt?: string } };
    expect(body.launchParams?.strategy).toBe("blueprint");
    expect(body.launchParams?.prompt).toBe("hi");
  });

  it("GET /api/runs/:runId omits launchParams when none stored", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    upsertRun(db, "ag", "no-snap");
    const res = await app.handle(new Request("http://localhost/api/runs/no-snap"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { launchParams?: unknown };
    expect(body.launchParams).toBeUndefined();
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

  it("persists AgentStarted delegation context and serves it on list + single-run", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    const layer = CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive));
    const child = "task-root.alpha-0a1b2c3d";
    const send = (runId: string, event: Record<string, unknown>) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CortexIngestService;
          yield* svc.handleEvent(`agent-${runId}`, runId, {
            v: 1,
            agentId: `agent-${runId}`,
            runId,
            event: event as unknown as AgentEvent,
          });
        }).pipe(Effect.provide(layer)),
      );
    await send("task-root", { _tag: "AgentStarted", taskId: "task-root", rootRunId: "task-root", depth: 0 });
    await send("task-child", { _tag: "AgentStarted", taskId: "task-child", agentDisplayName: "alpha", rootRunId: "task-root", parentRunId: child, depth: 1, runId: child });

    const list = (await (await app.handle(new Request("http://localhost/api/runs"))).json()) as Array<Record<string, unknown>>;
    const root = list.find((r) => r.runId === "task-root")!;
    const kid = list.find((r) => r.runId === "task-child")!;
    expect(root.parentRunId).toBeUndefined();
    expect(kid).toMatchObject({ displayName: "alpha", parentRunId: child, rootRunId: "task-root", depth: 1, contextRunId: child });
    expect(root.contextRunId).toBeUndefined();

    const one = (await (await app.handle(new Request("http://localhost/api/runs/task-child"))).json()) as Record<string, unknown>;
    expect(one).toMatchObject({ parentRunId: child, rootRunId: "task-root", depth: 1, contextRunId: child });
  });

  it("applySchema adds delegation columns to a pre-existing cortex_runs table idempotently", () => {
    const db = new Database(":memory:");
    applySchema(db);
    db.exec("ALTER TABLE cortex_runs DROP COLUMN parent_run_id");
    applySchema(db);
    applySchema(db);
    const cols = (db.prepare("PRAGMA table_info(cortex_runs)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("parent_run_id");
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

  it("passes execution controls: timeout", async () => {
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
        }),
      }),
    );

    expect(captured.params?.timeout).toBe(30000);
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

  it("passes runtimeVerification and terminalTools to runner", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    const app = makeCapApp(db, captured);

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Go",
          runtimeVerification: true,
          terminalTools: true,
        }),
      }),
    );

    expect(captured.params?.runtimeVerification).toBe(true);
    expect(captured.params?.terminalTools).toBe(true);
  });

  it("passes additionalToolNames to runner", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    const app = makeCapApp(db, captured);

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Go",
          tools: ["web-search"],
          additionalToolNames: "  lab-widget, http-get  ",
        }),
      }),
    );

    expect(captured.params?.tools).toEqual(["web-search"]);
    expect(captured.params?.additionalToolNames).toBe("lab-widget, http-get");
  });

  it("passes terminal shell command lists to runner", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    const app = makeCapApp(db, captured);

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Go",
          terminalTools: true,
          terminalShellAdditionalCommands: "bun, gh",
          terminalShellAllowedCommands: "  git, ls  ",
        }),
      }),
    );

    expect(captured.params?.terminalShellAdditionalCommands).toBe("bun, gh");
    expect(captured.params?.terminalShellAllowedCommands).toBe("git, ls");
  });

  // The route used to forward the body untyped (`as any`); the loosely-schema'd
  // fields are now narrowed to the LaunchParams types before reaching the runner.
  it("narrows agentTools, variables and modelRouting.tierModels to typed launch params", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    const app = makeCapApp(db, captured);

    const res = await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Go {{topic}}",
          agentTools: [
            { kind: "remote", toolName: "helper", remoteUrl: "http://x.test" },
            { kind: "remote", toolName: "no-url" },
            "junk",
          ],
          variables: [{ name: "topic", type: "string", required: false, default: "ai" }, { type: "string" }],
          modelRouting: { enabled: true, minTier: "sonnet", tierModels: { opus: "big", bogus: "x" } },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(captured.params?.agentTools).toEqual([
      { kind: "remote", toolName: "helper", remoteUrl: "http://x.test" },
    ]);
    expect(captured.params?.variables).toEqual([
      { name: "topic", type: "string", required: false, default: "ai" },
    ]);
    expect(captured.params?.modelRouting).toEqual({
      enabled: true,
      minTier: "sonnet",
      tierModels: { opus: "big" },
    });
  });

  it("omits agentTools when no entry is well-formed", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    const app = makeCapApp(db, captured);

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Go", agentTools: [{ kind: "local", toolName: "t" }] }),
      }),
    );

    expect(captured.params?.agentTools).toBeUndefined();
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

describe("error_message persistence", () => {
  it("updateRunStats stores error_message when provided", () => {
    const db = new Database(":memory:");
    applySchema(db);
    upsertRun(db, "a", "err-run");
    updateRunStats(db, "err-run", {
      status: "failed",
      errorMessage: "LLM provider connection refused",
    });

    const row = db.prepare("SELECT error_message FROM cortex_runs WHERE run_id = ?").get("err-run") as {
      error_message: string | null;
    };
    expect(row.error_message).toBe("LLM provider connection refused");
  });

  it("GET /api/runs/:runId includes errorMessage when failure has error", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    upsertRun(db, "a", "err-run-api");
    updateRunStats(db, "err-run-api", {
      status: "failed",
      errorMessage: "Execution timed out after 30000ms",
    });

    const res = await app.handle(new Request("http://localhost/api/runs/err-run-api"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; status: string; errorMessage?: string };
    expect(body.status).toBe("failed");
    expect(body.errorMessage).toBe("Execution timed out after 30000ms");
  });

  it("errorMessage is absent on successful runs", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    upsertRun(db, "a", "ok-run");
    updateRunStats(db, "ok-run", { status: "completed" });

    const res = await app.handle(new Request("http://localhost/api/runs/ok-run"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; status: string; errorMessage?: string };
    expect(body.status).toBe("completed");
    expect(body.errorMessage).toBeUndefined();
  });
});

describe("Durable HITL endpoints (Phase E)", () => {
  it("GET /api/runs/pending-approvals returns the approvals list", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    const res = await app.handle(new Request("http://localhost/api/runs/pending-approvals"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approvals: unknown[] };
    expect(Array.isArray(body.approvals)).toBe(true);
  });

  it("POST /api/runs/:runId/approve returns ok", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    const res = await app.handle(
      new Request("http://localhost/api/runs/run-1/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "looks good" }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });
  });

  it("POST /api/runs/:runId/deny returns ok", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);
    const res = await app.handle(
      new Request("http://localhost/api/runs/run-1/deny", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "nope" }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });
  });
});

describe("POST /api/runs/:runId/terminate (C4)", () => {
  it("returns 200 and calls runner.terminate with the runId", async () => {
    let terminatedWith = "";
    const terminateLayer = Layer.succeed(CortexRunnerService, {
      start: () =>
        Effect.succeed({ agentId: "a", runId: "r" }),
      pause: () => Effect.void,
      resume: () => Effect.void,
      stop: () => Effect.void,
      terminate: (runId) => {
        terminatedWith = String(runId);
        return Effect.void;
      },
      getActive: () => Effect.succeed(new Map()),
      listPendingApprovals: () => Effect.succeed([]),
      approveApproval: () => Effect.void,
      denyApproval: () => Effect.void,
      listPendingInteractions: () => Effect.succeed([]),
      respondToInteraction: () => Effect.succeed({ success: true, output: "" }),
    });
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(runsRouter(CortexStoreServiceLive(db), terminateLayer));

    const res = await app.handle(
      new Request("http://localhost/api/runs/run-1/terminate", { method: "POST" }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });
    expect(terminatedWith).toBe("run-1");
  });
});

describe("POST /api/runs/:runId/rerun (D2)", () => {
  it("relaunches a new run from the stored snapshot", async () => {
    const captured = { params: null as LaunchParams | null };
    const rerunLayer = Layer.succeed(CortexRunnerService, {
      start: (params) => {
        captured.params = params;
        return Effect.succeed({ agentId: "new-a", runId: "new-r" });
      },
      pause: () => Effect.void,
      resume: () => Effect.void,
      stop: () => Effect.void,
      terminate: () => Effect.void,
      getActive: () => Effect.succeed(new Map()),
      listPendingApprovals: () => Effect.succeed([]),
      approveApproval: () => Effect.void,
      denyApproval: () => Effect.void,
      listPendingInteractions: () => Effect.succeed([]),
      respondToInteraction: () => Effect.succeed({ success: true, output: "" }),
    });
    const db = new Database(":memory:");
    applySchema(db);
    upsertRun(db, "ag", "orig-run", "Orig", JSON.stringify({ prompt: "hi", strategy: "blueprint", provider: "test" }));
    const app = new Elysia().use(runsRouter(CortexStoreServiceLive(db), rerunLayer));

    const res = await app.handle(
      new Request("http://localhost/api/runs/orig-run/rerun", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId?: string };
    expect(body.runId).toBe("new-r");
    expect(captured.params?.strategy).toBe("blueprint");
    expect(captured.params?.prompt).toBe("hi");
  });

  it("returns 400 when the run has no stored snapshot", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    upsertRun(db, "ag", "bare-run");
    const app = appWithRunsDb(db);
    const res = await app.handle(
      new Request("http://localhost/api/runs/bare-run/rerun", { method: "POST" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/runs — durableRuns passthrough (Phase E)", () => {
  it("forwards durableRuns + approvalPolicy to the runner", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(runsRouter(CortexStoreServiceLive(db), captureRunnerLayer(captured)));

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "do a risky thing",
          provider: "test",
          durableRuns: {
            enabled: true,
            checkpointEvery: 2,
            approvalPolicy: { tools: ["shell-execute"], mode: "detach" },
          },
        }),
      }),
    );

    expect(captured.params?.durableRuns?.enabled).toBe(true);
    expect(captured.params?.durableRuns?.checkpointEvery).toBe(2);
    expect(captured.params?.durableRuns?.approvalPolicy?.tools).toEqual(["shell-execute"]);
  });

  it("omits durableRuns when not enabled", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(runsRouter(CortexStoreServiceLive(db), captureRunnerLayer(captured)));

    await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "plain", provider: "test" }),
      }),
    );

    expect(captured.params?.durableRuns).toBeUndefined();
  });
});
