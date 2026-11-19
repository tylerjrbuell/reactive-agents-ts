// Desk Continue is a NEW linked run (services/desk-continue.ts), like chat Continue:
//  - the continuation files its own Cortex run row (continuedFrom = parent, the parent's launch config),
//  - its events land on that row and the parent row/events are untouched,
//  - Continue answers with the NEW run id, which the runner holds as active until it ends,
//  - the parent is no longer offered beside its child (loop-stopped list),
//  - a crashed (live) parent row is closed once its continuation started,
//  - events key by their taskId: only `<durable id>-cont-<8hex>` names the new run.
import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import { listDurableRuns, RunStoreLive, RunStoreService } from "@reactive-agents/runtime";
import { createCortexRuntime } from "../runtime.js";
import { defaultCortexConfig } from "../types.js";
import { CortexRunnerService } from "../services/runner-service.js";
import { continuationIdOf } from "../services/desk-continue.js";
import { closeContinuedRunRow, findLoopStoppedRuns } from "../services/loop-stopped-runs.js";
import { getRunById } from "../db/queries.js";
import { rmDbFiles, rmTmpDirs, tmpDbPath, tmpDir } from "./helpers/tmp-db.js";

const STOP = { reason: "loop_detected:repeat", toolsDone: [], unfinished: ["finish"], iteration: 2 };
const dbPath = tmpDbPath("desk-continue");
afterAll(() => {
  rmDbFiles(dbPath);
  rmTmpDirs();
});

type Raw = { prepare: (sql: string) => { get: (...a: string[]) => unknown; all: (...a: string[]) => unknown[] } };

const waitFor = async (check: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe("continuationIdOf", () => {
  it("names a run only by the framework's continuation id of THIS parent", () => {
    expect(continuationIdOf("p1", { taskId: "p1-cont-0a1b2c3d" })).toBe("p1-cont-0a1b2c3d");
    expect(continuationIdOf("p1", { taskId: "p1" })).toBeUndefined();
    expect(continuationIdOf("p1", { taskId: "p2-cont-0a1b2c3d" })).toBeUndefined();
    expect(continuationIdOf("p1", { taskId: "p1-cont-0a1b2c3d.sub-12345678" })).toBeUndefined();
    expect(continuationIdOf("p1", { _tag: "x" })).toBeUndefined();
    expect(continuationIdOf("a.b", { taskId: "axb-cont-0a1b2c3d" })).toBeUndefined();
  });
});

describe("desk Continue as a new linked run", () => {
  it("files a new run row with continuedFrom and its events, leaves the parent alone, and drops the parent from the list", async () => {
    const durableDir = tmpDir("desk-continue-durable");
    const runtime = createCortexRuntime({ ...defaultCortexConfig, dbPath });
    const raw = runtime.rawDb as unknown as Raw;
    const runner = await Effect.runPromise(CortexRunnerService.pipe(Effect.provide(runtime.runnerLayer)));
    const row = (id: string) => raw.prepare("SELECT status, continued_from, launch_params_json FROM cortex_runs WHERE run_id = ?").get(id) as
      | { status: string; continued_from: string | null; launch_params_json: string | null }
      | null;
    const eventCount = (id: string) => (raw.prepare("SELECT COUNT(*) AS c FROM cortex_events WHERE run_id = ?").get(id) as { c: number }).c;

    const { runId: parent } = await Effect.runPromise(
      runner.start({
        provider: "test",
        prompt: "What is six times seven?",
        durableRuns: { enabled: true, dir: durableDir, checkpointEvery: 1 },
        testScenario: [{ text: "FINAL ANSWER: 42" }],
      }),
    );
    await waitFor(async () => row(parent)?.status === "completed" && !(await Effect.runPromise(runner.getActive())).has(parent));
    const parentEvents = eventCount(parent);
    expect(parentEvents).toBeGreaterThan(0);

    const dbFile = join(durableDir, "runs.db");
    const [record] = await Effect.runPromise(listDurableRuns({ dbPath: dbFile }));
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* (yield* RunStoreService).setLoopStop(record!.runId, STOP);
      }).pipe(Effect.provide(RunStoreLive(dbFile))),
    );

    const [stopped] = await Effect.runPromise(findLoopStoppedRuns(runtime.rawDb, { activeRunIds: new Set() }));
    expect(stopped?.runId).toBe(parent);

    // Continue: answers with the NEW run id; the parent is not the continued run.
    const started = await Effect.runPromise(runner.resumeCrashed(stopped!, { note: "finish it" }));
    const child = started.runId;
    expect(child).not.toBe(parent);
    expect(child).toMatch(new RegExp(`^${record!.runId}-cont-[0-9a-f]{8}$`));

    await waitFor(async () => row(child)?.status === "completed" && !(await Effect.runPromise(runner.getActive())).has(child));
    // The new row: linked to the parent, carrying the parent's launch config (Rerun / a later Continue need it).
    expect(row(child)?.continued_from).toBe(parent);
    expect(row(child)?.launch_params_json).toContain("What is six times seven?");
    expect(eventCount(child)).toBeGreaterThan(0);
    expect(getRunById(runtime.rawDb, child)?.continuedFrom).toBe(parent);
    // The parent: same row, same events, nothing filed under it by the continuation.
    expect(row(parent)).toMatchObject({ status: "completed", continued_from: null });
    expect(eventCount(parent)).toBe(parentEvents);

    // The parent is not offered beside its child; the child (its record is final) is the one in the list or none.
    const offered = await Effect.runPromise(findLoopStoppedRuns(runtime.rawDb, { activeRunIds: new Set() }));
    expect(offered.map((r) => r.runId)).not.toContain(parent);
    runtime.rawDb.close();
  }, 30_000);

  it("fails the Continue (no run row filed) when the framework refuses it", async () => {
    const durableDir = tmpDir("desk-continue-refused");
    const runtime = createCortexRuntime({ ...defaultCortexConfig, dbPath: tmpDbPath("desk-continue-refused") });
    const raw = runtime.rawDb as unknown as Raw;
    const runner = await Effect.runPromise(CortexRunnerService.pipe(Effect.provide(runtime.runnerLayer)));
    const { runId } = await Effect.runPromise(
      runner.start({
        provider: "test",
        prompt: "hi",
        durableRuns: { enabled: true, dir: durableDir, checkpointEvery: 1 },
        testScenario: [{ text: "FINAL ANSWER: hi" }],
      }),
    );
    await waitFor(async () => (raw.prepare("SELECT status FROM cortex_runs WHERE run_id = ?").get(runId) as { status: string } | null)?.status === "completed");
    const before = (raw.prepare("SELECT COUNT(*) AS c FROM cortex_runs").get() as { c: number }).c;
    // Not a resumable record (it completed, no stop): the framework refuses with RunNotResumableError.
    const [crashedLike] = await Effect.runPromise(
      Effect.gen(function* () {
        const rows = raw.prepare("SELECT run_id, agent_id, started_at, display_name, launch_params_json FROM cortex_runs WHERE run_id = ?").all(runId) as {
          run_id: string; agent_id: string; started_at: number; display_name: string | null; launch_params_json: string;
        }[];
        return rows.map((r) => ({
          runId: r.run_id,
          agentId: r.agent_id,
          name: r.display_name,
          startedAt: r.started_at,
          durableRunId: runId,
          checkpointIteration: 0,
          updatedAt: 0,
          launch: JSON.parse(r.launch_params_json) as never,
        }));
      }),
    );
    const exit = await Effect.runPromiseExit(runner.resumeCrashed(crashedLike!, { note: "again" }));
    expect(exit._tag).toBe("Failure");
    expect((raw.prepare("SELECT COUNT(*) AS c FROM cortex_runs").get() as { c: number }).c).toBe(before);
    runtime.rawDb.close();
  }, 30_000);
});

describe("closeContinuedRunRow", () => {
  it("closes a crashed (live) row and leaves a finished one alone", () => {
    const runtime = createCortexRuntime({ ...defaultCortexConfig, dbPath: tmpDbPath("desk-continue-close") });
    const raw = runtime.rawDb;
    raw.prepare("INSERT INTO cortex_runs (run_id, agent_id, started_at, status) VALUES ('live-1','a',1,'live'), ('done-1','a',1,'failed')").run();
    expect(closeContinuedRunRow(raw, "live-1")).toBe(true);
    expect(closeContinuedRunRow(raw, "done-1")).toBe(false);
    const status = (id: string) => (raw.prepare("SELECT status FROM cortex_runs WHERE run_id = ?").get(id) as { status: string }).status;
    expect(status("live-1")).toBe("stopped");
    expect(status("done-1")).toBe("failed");
    raw.close();
  });
});
