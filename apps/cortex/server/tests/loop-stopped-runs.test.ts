// Loop-stopped desk runs (services/loop-stopped-runs.ts, api/loop-stop-routes.ts): a durable
// desk run a loop guard stopped is listed with its stop and continued with the person's note
// through the runner (the framework's resumeRun), on the same Cortex run.
import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { listDurableRuns, RunStoreLive, RunStoreService, type ResumeRunOptions } from "@reactive-agents/runtime";
import { createCortexRuntime } from "../runtime.js";
import { defaultCortexConfig } from "../types.js";
import { CortexRunnerService } from "../services/runner-service.js";
import { loopStoppedRunsRouter } from "../api/loop-stop-routes.js";
import { ResumeGuard } from "../services/loop-stop-resume.js";
import { rmDbFiles, rmTmpDirs, tmpDbPath, tmpDir } from "./helpers/tmp-db.js";

const STOP = { reason: "loop_detected:repeat", repeatedTool: "web-search", toolsDone: [{ tool: "web-search", calls: 3 }], unfinished: ["write report"], iteration: 7 };
const dbPath = tmpDbPath("loop-stopped");

/** Wait until the run's row has left `live` and the runner no longer holds it (its durable record is final). */
const settled = async (rawDb: { prepare: (sql: string) => { get: (id: string) => unknown } }, runner: { getActive: () => Effect.Effect<ReadonlyMap<string, unknown>> }, runId: string) => {
  for (let i = 0; i < 200; i++) {
    const row = rawDb.prepare("SELECT status FROM cortex_runs WHERE run_id = ?").get(runId) as { status: string } | null;
    const active = await Effect.runPromise(runner.getActive());
    if (row && row.status !== "live" && !active.has(runId)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
};
afterAll(() => {
  rmDbFiles(dbPath);
  rmTmpDirs();
});

describe("loop-stopped desk runs", () => {
  it("lists a stopped run with its stop, continues it with the note, and keeps a finished run out", async () => {
    const durableDir = tmpDir("loop-stopped-durable");
    const runtime = createCortexRuntime({ ...defaultCortexConfig, dbPath });
    const realRunner = await Effect.runPromise(CortexRunnerService.pipe(Effect.provide(runtime.runnerLayer)));
    const statusOf = (runId: string) =>
      (runtime.rawDb.prepare("SELECT status FROM cortex_runs WHERE run_id = ?").get(runId) as { status: string } | null)?.status;

    // 1. A durable desk run on the test provider runs to the end.
    const { runId, agentId } = await Effect.runPromise(
      realRunner.start({
        provider: "test",
        prompt: "What is six times seven?",
        durableRuns: { enabled: true, dir: durableDir, checkpointEvery: 1 },
        testScenario: [{ text: "FINAL ANSWER: 42" }],
      }),
    );
    await settled(runtime.rawDb, realRunner, runId);
    expect(statusOf(runId)).toBe("completed");

    // A finished run the framework did not loop-stop is not offered.
    const resumeCalls: { runId: string; options: ResumeRunOptions | undefined }[] = [];
    const fakeRunner = Layer.succeed(CortexRunnerService, {
      ...realRunner,
      resumeCrashed: (crashed, options) => {
        resumeCalls.push({ runId: crashed.durableRunId, options });
        return Effect.succeed({ agentId: crashed.agentId, runId: crashed.runId });
      },
    });
    const app = loopStoppedRunsRouter(runtime.rawDb, fakeRunner, undefined, new ResumeGuard());
    const get = async () =>
      (await (await app.handle(new Request("http://localhost/api/loop-stopped-runs"))).json()) as { runs: { runId: string; launch?: unknown; kind: string; status: string; stop?: unknown }[] };
    expect((await get()).runs).toEqual([]);

    // 2. The framework records a loop stop on its durable record.
    const dbFile = join(durableDir, "runs.db");
    const [record] = await Effect.runPromise(listDurableRuns({ dbPath: dbFile }));
    expect(record).toBeDefined();
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.setLoopStop(record!.runId, STOP);
      }).pipe(Effect.provide(RunStoreLive(dbFile))),
    );
    const listed = await get();
    expect(listed.runs).toHaveLength(1);
    expect(listed.runs[0]).toMatchObject({ runId, agentId, kind: "loop", stop: { ...STOP, kind: "loop" } });
    expect(listed.runs[0]!.launch).toBeUndefined();

    // 3. Bad input is a 400 and starts nothing.
    const bad = await app.handle(
      new Request(`http://localhost/api/loop-stopped-runs/${runId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extraIterations: 0 }),
      }),
    );
    expect(bad.status).toBe(400);
    expect(resumeCalls).toEqual([]);

    // 4. Continue passes the note and iterations to the runner untouched and leaves the parent row alone.
    const ok = await app.handle(
      new Request(`http://localhost/api/loop-stopped-runs/${runId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "use the cached file", extraIterations: 20 }),
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ agentId, runId });
    expect(resumeCalls).toEqual([{ runId: record!.runId, options: { note: "use the cached file", extraIterations: 20 } }]);
    // The Continue is a new linked run (desk-continue.ts): the parent's row is left as it was.
    expect(statusOf(runId)).toBe("completed");

    // 5. An unknown run is a 404.
    const missing = await app.handle(new Request("http://localhost/api/loop-stopped-runs/nope/resume", { method: "POST" }));
    expect(missing.status).toBe(404);
    runtime.rawDb.close();
  }, 30_000);

  it("leaves the run row alone when the runner cannot start the Continue", async () => {
    const durableDir = tmpDir("loop-stopped-fail");
    const runtime = createCortexRuntime({ ...defaultCortexConfig, dbPath: tmpDbPath("loop-stopped-fail") });
    const realRunner = await Effect.runPromise(CortexRunnerService.pipe(Effect.provide(runtime.runnerLayer)));
    const { runId } = await Effect.runPromise(
      realRunner.start({
        provider: "test",
        prompt: "hi",
        durableRuns: { enabled: true, dir: durableDir, checkpointEvery: 1 },
        testScenario: [{ text: "FINAL ANSWER: hi" }],
      }),
    );
    const statusOf = () =>
      (runtime.rawDb.prepare("SELECT status FROM cortex_runs WHERE run_id = ?").get(runId) as { status: string } | null)?.status;
    await settled(runtime.rawDb, realRunner, runId);
    const dbFile = join(durableDir, "runs.db");
    const [record] = await Effect.runPromise(listDurableRuns({ dbPath: dbFile }));
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.setLoopStop(record!.runId, STOP);
      }).pipe(Effect.provide(RunStoreLive(dbFile))),
    );
    const failing = Layer.succeed(CortexRunnerService, {
      ...realRunner,
      resumeCrashed: () => Effect.die(new Error("cannot build agent")),
    });
    const app = loopStoppedRunsRouter(runtime.rawDb, failing, undefined, new ResumeGuard());
    const res = await app.handle(new Request(`http://localhost/api/loop-stopped-runs/${runId}/resume`, { method: "POST" }));
    expect(res.status).toBe(500);
    expect(statusOf()).toBe("completed");
    runtime.rawDb.close();
  }, 30_000);
});
