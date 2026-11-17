import { describe, expect, it, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { RunStoreLive, RunStoreService, defaultDurableRunsDir, listDurableRuns, type RunRecord } from "@reactive-agents/runtime";
import { createCortexRuntime } from "../runtime.js";
import { defaultCortexConfig } from "../types.js";
import { CortexRunnerService } from "../services/runner-service.js";
import { durableRunsDbPath, isDurableBuild, pickCrashedDurableRun } from "../services/crashed-runs.js";
import { crashedRunsRouter } from "../api/crashed-runs.js";

/** Run `fn` with REACTIVE_AGENTS_RUNS_DIR set (or cleared), restoring the preload's value after. */
function withRunsDirEnv(value: string | undefined, fn: () => void): void {
  const prev = process.env["REACTIVE_AGENTS_RUNS_DIR"];
  if (value === undefined) delete process.env["REACTIVE_AGENTS_RUNS_DIR"];
  else process.env["REACTIVE_AGENTS_RUNS_DIR"] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env["REACTIVE_AGENTS_RUNS_DIR"];
    else process.env["REACTIVE_AGENTS_RUNS_DIR"] = prev;
  }
}

const root = mkdtempSync(join(tmpdir(), "cortex-crashed-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const rec = (over: Partial<RunRecord>): RunRecord => ({
  runId: "d1",
  agentId: "a",
  task: "t",
  status: "running",
  configHash: "h",
  updatedAt: 1,
  ...over,
});

describe("crashed-run helpers", () => {
  it("a build is durable only with durable runs on (a detach approval policy waits live)", () => {
    expect(isDurableBuild({ durableRuns: { enabled: true } })).toBe(true);
    expect(isDurableBuild({ approvalPolicy: { mode: "detach", tools: ["x"] } })).toBe(false);
    expect(isDurableBuild({ durableRuns: { enabled: false } })).toBe(false);
    expect(isDurableBuild({})).toBe(false);
  });

  it("the store path is the configured dir, else the framework default under the agent id", () => {
    expect(durableRunsDbPath("agent-1", "/tmp/d")).toBe("/tmp/d/runs.db");
    withRunsDirEnv(undefined, () => {
      expect(durableRunsDbPath("agent-1", undefined, "/home/u")).toBe("/home/u/.reactive-agents/agent-1/runs.db");
    });
  });

  it("the default store follows the framework resolver (REACTIVE_AGENTS_RUNS_DIR), the one the writer uses", () => {
    withRunsDirEnv("/srv/runs", () => {
      expect(durableRunsDbPath("agent-1")).toBe(join(defaultDurableRunsDir("agent-1"), "runs.db"));
      expect(durableRunsDbPath("agent-1")).toBe("/srv/runs/agent-1/runs.db");
      expect(durableRunsDbPath("agent-1", "/tmp/d")).toBe("/tmp/d/runs.db"); // an explicit dir still wins
    });
  });

  it("picks the newest run a crash left mid-run, never one waiting on a person or finished", () => {
    expect(
      pickCrashedDurableRun([
        rec({ runId: "old", updatedAt: 1, resumable: true }),
        rec({ runId: "new", status: "paused", updatedAt: 5, resumable: true }),
        rec({ runId: "gate", status: "awaiting-approval", updatedAt: 9 }),
        rec({ runId: "done", status: "completed", updatedAt: 10 }),
      ])?.runId,
    ).toBe("new");
    expect(pickCrashedDurableRun([rec({ status: "completed" }), rec({ status: "failed" })])).toBeUndefined();
  });
});

describe("resume a crashed durable desk run (framework resumeRun)", () => {
  it("lists a run a crash left mid-run and resumes it to completion on the same Cortex run", async () => {
    const durableDir = join(root, "durable");
    const runtime = createCortexRuntime({ ...defaultCortexConfig, dbPath: join(root, "cortex.db") });
    const app = crashedRunsRouter(runtime.rawDb, runtime.runnerLayer, root);
    const runner = await Effect.runPromise(CortexRunnerService.pipe(Effect.provide(runtime.runnerLayer)));
    const statusOf = (runId: string) =>
      (runtime.rawDb.prepare("SELECT status FROM cortex_runs WHERE run_id = ?").get(runId) as { status: string } | null)?.status;
    const settle = async (runId: string) => {
      for (let i = 0; i < 200; i++) {
        const active = await Effect.runPromise(runner.getActive());
        if (!active.has(runId) && statusOf(runId) !== "live") return;
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    // 1. A durable desk run on the test provider runs to the end.
    const { runId, agentId } = await Effect.runPromise(
      runner.start({
        provider: "test",
        prompt: "What is six times seven?",
        durableRuns: { enabled: true, dir: durableDir, checkpointEvery: 1 },
        testScenario: [{ text: "FINAL ANSWER: 42" }],
      }),
    );
    await settle(runId);
    expect(statusOf(runId)).toBe("completed");

    // Nothing crashed yet: a finished run is not offered.
    const none = (await (await app.handle(new Request("http://localhost/api/crashed-runs"))).json()) as { runs: unknown[] };
    expect(none.runs).toEqual([]);

    // 2. Simulate the crash: the process died mid-run, so the durable store still
    // says running and the Cortex row is still live.
    const dbPath = join(durableDir, "runs.db");
    const [record] = await Effect.runPromise(listDurableRuns({ dbPath }));
    expect(record).toBeDefined();
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.setStatus(record!.runId, "running");
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );
    runtime.rawDb.prepare("UPDATE cortex_runs SET status = 'live', ending = NULL WHERE run_id = ?").run(runId);

    const listed = (await (await app.handle(new Request("http://localhost/api/crashed-runs"))).json()) as {
      runs: { runId: string; agentId: string; durableRunId: string; launch?: unknown }[];
    };
    expect(listed.runs).toHaveLength(1);
    expect(listed.runs[0]).toMatchObject({ runId, agentId, durableRunId: record!.runId });
    expect(listed.runs[0]!.launch).toBeUndefined();

    // 3. Resume: same Cortex run, the framework finishes it.
    const res = await app.handle(new Request(`http://localhost/api/crashed-runs/${runId}/resume`, { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agentId, runId });
    await settle(runId);
    expect(statusOf(runId)).toBe("completed");
    const after = await Effect.runPromise(listDurableRuns({ dbPath }));
    expect(after.find((r) => r.runId === record!.runId)?.status).toBe("completed");

    // A resumed (finished) run is no longer offered, and resuming it again is 404.
    const again = await app.handle(new Request(`http://localhost/api/crashed-runs/${runId}/resume`, { method: "POST" }));
    expect(again.status).toBe(404);
    runtime.rawDb.close();
  }, 30_000);
});
