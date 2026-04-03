import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { CortexIngestService, CortexIngestServiceLive } from "../services/ingest-service.js";
import { CortexEventBridgeLive } from "../services/event-bridge.js";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";

const makeTestDb = () => {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
};

const makeTestLayer = (db: Database) =>
  CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive));

describe("CortexIngestService", () => {
  it("should persist an event to SQLite", async () => {
    const db = makeTestDb();

    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      yield* svc.handleEvent("agent-1", "run-1", {
        v: 1,
        agentId: "agent-1",
        runId: "run-1",
        event: { _tag: "TaskCreated", taskId: "t1" },
      });
    });

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(db))));

    const rows = db.prepare("SELECT * FROM cortex_events WHERE run_id = 'run-1'").all();
    expect(rows).toHaveLength(1);
  });

  it("should report 0 subscribers for unknown agent", async () => {
    const db = makeTestDb();

    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      const count = yield* svc.getSubscriberCount("unknown-agent");
      expect(count).toBe(0);
    });

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(db))));
  });

  it("updates run stats from LLMRequestCompleted", async () => {
    const db = makeTestDb();
    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      yield* svc.handleEvent("a", "r-llm", {
        v: 1,
        agentId: "a",
        runId: "r-llm",
        event: {
          _tag: "LLMRequestCompleted",
          taskId: "t",
          requestId: "req",
          model: "m",
          provider: "anthropic",
          durationMs: 10,
          tokensUsed: 250,
          estimatedCost: 0.005,
        },
      });
    });
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(db))));
    const row = db
      .prepare("SELECT tokens_used, cost_usd FROM cortex_runs WHERE run_id = 'r-llm'")
      .get() as { tokens_used: number; cost_usd: number };
    expect(row.tokens_used).toBe(250);
    expect(row.cost_usd).toBeCloseTo(0.005);
  });

  it("updates iteration from ReasoningStepCompleted", async () => {
    const db = makeTestDb();
    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      yield* svc.handleEvent("a", "r-rs", {
        v: 1,
        agentId: "a",
        runId: "r-rs",
        event: {
          _tag: "ReasoningStepCompleted",
          taskId: "t",
          strategy: "reactive",
          step: 1,
          totalSteps: 7,
        },
      });
    });
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(db))));
    const row = db.prepare("SELECT iteration_count FROM cortex_runs WHERE run_id = 'r-rs'").get() as {
      iteration_count: number;
    };
    expect(row.iteration_count).toBe(7);
  });

  it("marks run completed from AgentCompleted success", async () => {
    const db = makeTestDb();
    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      yield* svc.handleEvent("a", "r-ac", {
        v: 1,
        agentId: "a",
        runId: "r-ac",
        event: {
          _tag: "AgentCompleted",
          taskId: "t",
          agentId: "a",
          success: true,
          totalIterations: 2,
          totalTokens: 10,
          durationMs: 100,
        },
      });
    });
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(db))));
    const row = db.prepare("SELECT status FROM cortex_runs WHERE run_id = 'r-ac'").get() as { status: string };
    expect(row.status).toBe("completed");
  });

  it("marks run completed when AgentCompleted omits success (only explicit false is failure)", async () => {
    const db = makeTestDb();
    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      yield* svc.handleEvent("a", "r-ac-no-success", {
        v: 1,
        agentId: "a",
        runId: "r-ac-no-success",
        event: {
          _tag: "AgentCompleted",
          taskId: "t",
          agentId: "a",
          success: true,
          totalIterations: 1,
          totalTokens: 8,
          durationMs: 40,
        } as { _tag: "AgentCompleted"; taskId: string; agentId: string; success: boolean; totalIterations: number; totalTokens: number; durationMs: number },
      });
    });
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(db))));
    const row = db
      .prepare("SELECT status FROM cortex_runs WHERE run_id = 'r-ac-no-success'")
      .get() as { status: string };
    expect(row.status).toBe("completed");
  });

  it("marks run failed from AgentCompleted with success false", async () => {
    const db = makeTestDb();
    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      yield* svc.handleEvent("a", "r-ac-fail", {
        v: 1,
        agentId: "a",
        runId: "r-ac-fail",
        event: {
          _tag: "AgentCompleted",
          taskId: "t",
          agentId: "a",
          success: false,
          totalIterations: 1,
          totalTokens: 0,
          durationMs: 10,
        },
      });
    });
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(db))));
    const row = db.prepare("SELECT status FROM cortex_runs WHERE run_id = 'r-ac-fail'").get() as { status: string };
    expect(row.status).toBe("failed");
  });

  it("marks run failed from TaskFailed", async () => {
    const db = makeTestDb();
    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      yield* svc.handleEvent("a", "r-tf", {
        v: 1,
        agentId: "a",
        runId: "r-tf",
        event: {
          _tag: "TaskFailed",
          taskId: "t",
          error: "boom",
        },
      });
    });
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(db))));
    const row = db.prepare("SELECT status FROM cortex_runs WHERE run_id = 'r-tf'").get() as { status: string };
    expect(row.status).toBe("failed");
  });

  it("stores debrief JSON from DebriefCompleted", async () => {
    const db = makeTestDb();
    const debriefPayload = {
      outcome: "success" as const,
      summary: "done",
      keyFindings: [] as const,
      errorsEncountered: [] as const,
      lessonsLearned: [] as const,
      confidence: "high" as const,
      toolsUsed: [] as const,
      metrics: { tokens: 0, duration: 0, iterations: 0, cost: 0 },
      markdown: "# Done",
    };
    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      yield* svc.handleEvent("a", "r-db", {
        v: 1,
        agentId: "a",
        runId: "r-db",
        event: {
          _tag: "DebriefCompleted",
          taskId: "t",
          agentId: "a",
          debrief: debriefPayload,
        },
      });
    });
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(db))));
    const row = db.prepare("SELECT debrief FROM cortex_runs WHERE run_id = 'r-db'").get() as { debrief: string };
    expect(JSON.parse(row.debrief)).toEqual(debriefPayload);
  });

  it("normalizes inconsistent agentId for same run to canonical run agent", async () => {
    const db = makeTestDb();
    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      // First event establishes canonical run agent id.
      yield* svc.handleEvent("cli-agent-1", "r-norm", {
        v: 1,
        agentId: "cli-agent-1",
        runId: "r-norm",
        event: {
          _tag: "AgentStarted",
          taskId: "r-norm",
          agentId: "cli-agent-1",
          provider: "test",
          model: "m",
          timestamp: Date.now(),
        },
      });
      // Follow-up event arrives with degraded agent id (= run id).
      yield* svc.handleEvent("r-norm", "r-norm", {
        v: 1,
        agentId: "r-norm",
        runId: "r-norm",
        event: {
          _tag: "ExecutionPhaseEntered",
          taskId: "r-norm",
          phase: "think",
          iteration: 1,
          timestamp: Date.now(),
        } as any,
      });
    });

    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(db))));
    const rows = db
      .prepare("SELECT DISTINCT agent_id FROM cortex_events WHERE run_id = 'r-norm'")
      .all() as Array<{ agent_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.agent_id).toBe("cli-agent-1");
  });

  it("ignores known internal pseudo-runs", async () => {
    const db = makeTestDb();
    const program = Effect.gen(function* () {
      const svc = yield* CortexIngestService;
      yield* svc.handleEvent("structured-output", "structured-output", {
        v: 1,
        agentId: "structured-output",
        runId: "structured-output",
        event: {
          _tag: "ReasoningStepCompleted",
          taskId: "structured-output",
          strategy: "reactive",
          step: 1,
          totalSteps: 1,
        },
      });
    });
    await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(db))));
    const rows = db.prepare("SELECT * FROM cortex_runs WHERE run_id = 'structured-output'").all();
    expect(rows).toHaveLength(0);
  });
});
