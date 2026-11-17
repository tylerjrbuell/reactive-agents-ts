// Pause / Stop of a live durable run (services/run-interrupt.ts, chat-run-control.ts, runner
// stop / pause): the framework's pauseRun / stopRun end the run with a saved place to continue
// from, and the interrupted run is then offered by the resumable list with its kind.
import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import { listDurableRuns } from "@reactive-agents/runtime";
import { createCortexRuntime } from "../runtime.js";
import { defaultCortexConfig } from "../types.js";
import { CortexRunnerService } from "../services/runner-service.js";
import { interruptLiveRun, type InterruptableAgent } from "../services/run-interrupt.js";
import { ChatRunControl, interruptChatTurn } from "../services/chat-run-control.js";
import { findLoopStoppedRuns } from "../services/loop-stopped-runs.js";
import { rmDbFiles, rmTmpDirs, tmpDbPath, tmpDir } from "./helpers/tmp-db.js";
import type { RunId } from "../types.js";

const dbPath = tmpDbPath("run-interrupt");
afterAll(() => {
  rmDbFiles(dbPath);
  rmTmpDirs();
});

const fakeAgent = (over: Partial<InterruptableAgent> & { ids?: readonly string[] }): InterruptableAgent => ({
  activeRunIds: () => over.ids ?? ["d1"],
  pauseRun: over.pauseRun ?? (async () => true),
  stopRun: over.stopRun ?? (async () => true),
});

describe("interruptLiveRun", () => {
  it("is persisted when the framework ends the run, and asks the matching method for the live id", async () => {
    const asked: string[] = [];
    const agent = fakeAgent({
      pauseRun: async (id) => (asked.push(`pause:${id}`), true),
      stopRun: async (id) => (asked.push(`stop:${id}`), true),
    });
    expect(await interruptLiveRun(agent, "pause", 1_000)).toBe("persisted");
    expect(await interruptLiveRun(agent, "stop", 1_000)).toBe("persisted");
    expect(asked).toEqual(["pause:d1", "stop:d1"]);
  });

  it("is not-live with no live durable run, when the framework answers false, or when the call fails", async () => {
    expect(await interruptLiveRun(fakeAgent({ ids: [] }), "stop")).toBe("not-live");
    expect(await interruptLiveRun(fakeAgent({ stopRun: async () => false }), "stop")).toBe("not-live");
    expect(
      await interruptLiveRun(fakeAgent({ stopRun: () => Promise.reject(new Error("store closed")) }), "stop"),
    ).toBe("not-live");
  });

  it("is pending when the run does not reach a boundary within the grace window", async () => {
    const agent = fakeAgent({ stopRun: () => new Promise<boolean>(() => undefined) });
    expect(await interruptLiveRun(agent, "stop", 20)).toBe("pending");
  });
});

describe("chat Stop / Pause", () => {
  const ports = (agent: InterruptableAgent | undefined, aborted: string[]) => ({
    resume: { control: new ChatRunControl({ liveAgentOf: () => agent }) },
    stopTurn: (id: string) => (aborted.push(id), true),
  });

  it("ends the durable run through the framework first, then aborts the streamed turn as the user", async () => {
    const order: string[] = [];
    const agent = fakeAgent({ pauseRun: async () => (order.push("pauseRun"), true) });
    const out = await interruptChatTurn(
      { resume: { control: new ChatRunControl({ liveAgentOf: () => agent }) }, stopTurn: () => (order.push("abort"), true) },
      "s1",
      "pause",
    );
    expect(order).toEqual(["pauseRun", "abort"]);
    expect(out).toEqual({ stopped: true, persisted: true, outcome: "persisted" });
  });

  it("passes the requested kind to the turn abort, so a Pause reads as paused and a Stop as stopped", async () => {
    const kinds: string[] = [];
    const agent = fakeAgent({});
    const stopTurn = (_id: string, kind?: string) => (kinds.push(kind ?? "none"), true);
    await interruptChatTurn({ resume: { control: new ChatRunControl({ liveAgentOf: () => agent }) }, stopTurn }, "s1", "pause");
    await interruptChatTurn({ resume: { control: new ChatRunControl({ liveAgentOf: () => agent }) }, stopTurn }, "s1", "stop");
    expect(kinds).toEqual(["pause", "stop"]);
  });

  it("a Pause on a run that is not durable ends the turn as a Stop: nothing was saved to pick up, so it never reads 'paused'", async () => {
    const kinds: string[] = [];
    const stopTurn = (_id: string, kind?: string) => (kinds.push(kind ?? "none"), true);
    const out = await interruptChatTurn({ resume: { control: new ChatRunControl({ liveAgentOf: () => undefined }) }, stopTurn }, "s1", "pause");
    expect(kinds).toEqual(["stop"]);
    expect(out.persisted).toBe(false);
  });

  it("with no live durable agent it only aborts the turn, as Stop always did", async () => {
    const aborted: string[] = [];
    expect(await interruptChatTurn(ports(undefined, aborted), "s1", "stop")).toEqual({ stopped: true, persisted: false, outcome: "not-live" });
    expect(aborted).toEqual(["s1"]);
  });

  it("lists the session agent's live run ids so a running run is never offered as resumable", () => {
    const control = new ChatRunControl({ liveAgentOf: (id) => (id === "s1" ? fakeAgent({ ids: ["d9"] }) : undefined) });
    expect(control.liveRunIds("s1")).toEqual(["d9"]);
    expect(control.liveRunIds("other")).toEqual([]);
  });
});

describe("desk run Stop / Pause through the runner (real durable run, test provider)", () => {
  const slowScenario = [
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ toolCall: { name: "file-read", args: { path: `/definitely/not/here-${n}.txt` } }, delayMs: 250 })),
    { text: "FINAL ANSWER: done" },
  ];

  const startSlow = async (kind: string) => {
    const durableDir = tmpDir(`run-interrupt-${kind}`);
    const runtime = createCortexRuntime({ ...defaultCortexConfig, dbPath });
    const runner = await Effect.runPromise(CortexRunnerService.pipe(Effect.provide(runtime.runnerLayer)));
    const started = await Effect.runPromise(
      runner.start({
        provider: "test",
        prompt: "read the files",
        tools: ["file-read"],
        durableRuns: { enabled: true, dir: durableDir, checkpointEvery: 1 },
        testScenario: slowScenario,
      }),
    );
    await new Promise((r) => setTimeout(r, 400));
    return { runtime, runner, durableDir, ...started };
  };

  const waitEnded = async (runtime: ReturnType<typeof createCortexRuntime>, runner: { getActive: () => Effect.Effect<ReadonlyMap<string, unknown>> }, runId: string) => {
    for (let i = 0; i < 200; i++) {
      const row = runtime.rawDb.prepare("SELECT status FROM cortex_runs WHERE run_id = ?").get(runId) as { status: string } | null;
      const active = await Effect.runPromise(runner.getActive());
      if (row && row.status !== "live" && !active.has(runId)) return row.status;
      await new Promise((r) => setTimeout(r, 50));
    }
    return "timeout";
  };

  for (const kind of ["stop", "pause"] as const) {
    it(`${kind} ends a durable run with a saved place to continue from and it is listed as resumable with its kind`, async () => {
      const { runtime, runner, durableDir, runId } = await startSlow(kind);
      const out = await Effect.runPromise(kind === "stop" ? runner.stop(runId as RunId) : runner.pause(runId as RunId));
      expect(out).toBe("persisted");
      expect(await waitEnded(runtime, runner, runId)).toBe("stopped");

      const [record] = await Effect.runPromise(listDurableRuns({ dbPath: join(durableDir, "runs.db") }));
      expect(record?.resumable).toBe(true);
      expect(record?.stop?.kind).toBe(kind === "stop" ? "user-stopped" : "user-paused");

      const resumable = await Effect.runPromise(findLoopStoppedRuns(runtime.rawDb, { activeRunIds: new Set() }));
      const mine = resumable.find((r) => r.runId === runId);
      expect(mine).toMatchObject({ kind: kind === "stop" ? "user-stopped" : "user-paused", durableRunId: record?.runId });
      runtime.rawDb.close();
    }, 30_000);
  }
});
