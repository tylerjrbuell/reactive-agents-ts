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
