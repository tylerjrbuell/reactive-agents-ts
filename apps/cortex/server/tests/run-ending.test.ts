// Run: bun run repo test apps/cortex/server/tests/run-ending.test.ts
//
// A run's ending is stored on cortex_runs.ending so Runs and Beacon can tell an
// abstention (status `failed`, a deliberate decline) from a real failure.
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { backfillRunEndings, getRecentRuns, insertEvent, recomputeRunStats, upsertRun } from "../db/queries.js";
import { CortexIngestService, CortexIngestServiceLive } from "../services/ingest-service.js";
import { CortexEventBridgeLive } from "../services/event-bridge.js";
import type { CortexIngestMessage } from "../types.js";

const abstained = {
  _tag: "AgentCompleted",
  taskId: "t",
  agentId: "a",
  success: false,
  totalIterations: 2,
  totalTokens: 40,
  durationMs: 900,
  terminatedBy: "abstained",
  abstention: { reason: "No account statement was provided", missing: ["statement"] },
  error: "No account statement was provided",
};
const failed = { _tag: "AgentCompleted", taskId: "t", agentId: "a", success: false, totalIterations: 1, totalTokens: 10, durationMs: 100, error: "LLM timeout" };
const succeeded = { _tag: "AgentCompleted", taskId: "t", agentId: "a", success: true, totalIterations: 1, totalTokens: 10, durationMs: 100 };

const msg = (runId: string, event: Record<string, unknown>): CortexIngestMessage =>
  ({ v: 1, agentId: "a", runId, event } as unknown as CortexIngestMessage);

const summary = (db: Database, runId: string) => getRecentRuns(db, 50).find((r) => r.runId === runId);

describe("run ending", () => {
  it("ingest stores the ending from AgentCompleted: abstained stays apart from failed", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const layer = CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive));
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CortexIngestService;
        yield* svc.handleEvent("a", "r-abs", msg("r-abs", abstained));
        yield* svc.handleEvent("a", "r-fail", msg("r-fail", failed));
        yield* svc.handleEvent("a", "r-ok", msg("r-ok", succeeded));
      }).pipe(Effect.provide(layer)),
    );
    expect(summary(db, "r-abs")).toMatchObject({ status: "failed", ending: "abstained" });
    expect(summary(db, "r-fail")).toMatchObject({ status: "failed", ending: "failed" });
    expect(summary(db, "r-ok")).toMatchObject({ status: "completed", ending: "succeeded" });
  });

  // A run the strategy accepted after a capped pass (authority `strategy-accepted`) finished: the pass's
  // terminator (`max_iterations`) must not make the Runs table read it as stopped or failed.
  it("a strategy-accepted finish after a capped pass is completed/succeeded; an unknown authority changes nothing", async () => {
    const accepted = { ...succeeded, terminatedBy: "max_iterations", outcome: { status: "completed", terminatedBy: "max_iterations", authority: "strategy-accepted" } };
    const unknown = { ...succeeded, outcome: { status: "completed", authority: "an-authority-from-the-future" } };
    const db = new Database(":memory:");
    applySchema(db);
    const layer = CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive));
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CortexIngestService;
        yield* svc.handleEvent("a", "r-acc", msg("r-acc", accepted));
        yield* svc.handleEvent("a", "r-unk", msg("r-unk", unknown));
      }).pipe(Effect.provide(layer)),
    );
    expect(summary(db, "r-acc")).toMatchObject({ status: "completed", ending: "succeeded" });
    expect(summary(db, "r-unk")).toMatchObject({ status: "completed", ending: "succeeded" });
  });

  it("backfills runs stored before the column from their last AgentCompleted; recompute keeps it", () => {
    const db = new Database(":memory:");
    applySchema(db);
    upsertRun(db, "a", "old-abs");
    upsertRun(db, "a", "old-live");
    insertEvent(db, msg("old-abs", abstained), 0);
    db.prepare("UPDATE cortex_runs SET status = 'failed', ending = NULL").run();

    expect(backfillRunEndings(db)).toBe(1);
    expect(summary(db, "old-abs")?.ending).toBe("abstained");
    expect(summary(db, "old-live")?.ending).toBeUndefined();

    db.prepare("UPDATE cortex_runs SET ending = NULL WHERE run_id = 'old-abs'").run();
    expect(recomputeRunStats(db, "old-abs")).toBe(true);
    expect(summary(db, "old-abs")).toMatchObject({ status: "failed", ending: "abstained" });
  });
});

describe("a run the user stopped (honest partial, success:false)", () => {
  const stopped = {
    _tag: "AgentCompleted",
    taskId: "t",
    agentId: "a",
    success: false,
    totalIterations: 1,
    totalTokens: 10,
    durationMs: 100,
    output: "Half the report.",
    error: "The run was stopped on request before it finished.",
    outcome: { status: "partial", outstanding: ["stopped_by_request"] },
  };

  it("ingest sets status stopped, ending partial, and no error message (not failed)", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const layer = CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive));
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CortexIngestService;
        yield* svc.handleEvent("a", "r-stop", msg("r-stop", stopped));
      }).pipe(Effect.provide(layer)),
    );
    expect(summary(db, "r-stop")).toMatchObject({ status: "stopped", ending: "partial" });
    expect(summary(db, "r-stop")?.errorMessage ?? null).toBeNull();
  });

  it("recompute derives stopped for it, and a loop stop stays failed", () => {
    const db = new Database(":memory:");
    applySchema(db);
    upsertRun(db, "a", "r-stop");
    upsertRun(db, "a", "r-loop");
    insertEvent(db, msg("r-stop", stopped), 0);
    insertEvent(db, msg("r-loop", { ...stopped, outcome: undefined, stop: { kind: "loop" } }), 0);
    recomputeRunStats(db, "r-stop");
    recomputeRunStats(db, "r-loop");
    expect(summary(db, "r-stop")).toMatchObject({ status: "stopped", ending: "partial" });
    expect(summary(db, "r-loop")?.status).toBe("failed");
  });
});
