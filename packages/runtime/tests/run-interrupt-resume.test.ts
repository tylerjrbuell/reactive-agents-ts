/**
 * run-interrupt-resume.test.ts — any durable run that did not complete is
 * continuable from where it was, whatever stopped it. Zero token.
 *
 * Pins, on REAL durable runs (scripted provider, SQLite store in a temp dir):
 *   - a user stop (`stopRun`) / pause (`pauseRun`) takes effect at the next
 *     iteration boundary, leaves status `stopped` / `paused`, the typed stop
 *     record and a final checkpoint; `resumeRun` completes it with NO
 *     completed tool call run again;
 *   - a run that ended failed (spent budget) is `failed` + resumable and
 *     continues with `extraIterations`;
 *   - an error that escapes the run keeps its last good checkpoint and is
 *     resumable, the failing step never marked done;
 *   - a streamed run: `handle.stop()` and `handle.terminate()` leave it
 *     continuable;
 *   - a resumed run can be paused again;
 *   - the pure rules (`classifyEnd`, the run-store `resumable` rule, the live
 *     registry) and the checkpoint-wrapper overhead note.
 */
import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import type { ReactiveAgent } from "../src/reactive-agent.js";
import { RunController } from "../src/run-controller.js";
import { RunStoreLive, RunStoreService, type RunRecord } from "../src/services/run-store.js";
import { classifyEnd, persistInterrupt } from "../src/engine/run-interrupt.js";
import { makeActiveRuns } from "../src/engine/active-runs.js";
import { runDurableRun } from "../src/agent/run-durable.js";
import { prepareResume } from "../src/engine/run-resume.js";
import { installDurableCheckpointing } from "../src/run-controller.js";
import { parseLoopStopSummary } from "../src/loop-stop-summary.js";

const toolDef = (name: string) => ({
  name,
  description: `Tool ${name}`,
  parameters: [{ name: "q", type: "string" as const, description: "Input", required: true }],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
});

interface Counts { read: number; write: number }
interface Hooks { readonly onRead?: () => void; readonly onWrite?: () => void }

const agentOf = (dir: string, counts: Counts, script: readonly unknown[], hooks: Hooks = {}, maxIterations = 12) =>
  ReactiveAgents.create()
    .withName("interrupt-subject")
    .withSystemPrompt("You research then write.")
    .withTestScenario(script as never)
    .withTools({
      tools: [
        { definition: toolDef("read-tool"), handler: () => { counts.read++; hooks.onRead?.(); return Effect.succeed("note: ships 2026-03-01"); } },
        { definition: toolDef("write-tool"), handler: () => { counts.write++; hooks.onWrite?.(); return Effect.succeed("wrote notes.md"); } },
      ],
    })
    .withReasoning()
    .withMaxIterations(maxIterations)
    .withDurableRuns({ dir, checkpointEvery: 1 })
    .build();

const FIRST_RUN = [
  { toolCall: { name: "read-tool", args: { q: "a" } } },
  { toolCall: { name: "write-tool", args: { q: "notes" } } },
  { text: "FINAL ANSWER: ships 2026-03-01." },
];
const REST = [{ toolCall: { name: "write-tool", args: { q: "notes" } } }, { text: "FINAL ANSWER: ships 2026-03-01." }];
const TASK = "Find the release date";

const withTempDir = async (f: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), "ra-interrupt-"));
  try {
    await f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const rowOf = async (agent: ReactiveAgent, runId: string): Promise<RunRecord | undefined> =>
  (await agent.listRuns()).find((r) => r.runId === runId);

/** The one live run of an agent (read from inside a tool handler of that run). */
const liveRun = (agent: () => ReactiveAgent | undefined): string => {
  const id = agent()?.activeRunIds()[0];
  if (id === undefined) throw new Error("no live run to interrupt");
  return id;
};

describe("a user stop or pause leaves the run continuable", () => {
  it("stopRun at the next iteration boundary: status stopped, typed stop record, resume completes with no repeated tool call", async () => {
    await withTempDir(async (dir) => {
      const counts: Counts = { read: 0, write: 0 };
      let ref: ReactiveAgent | undefined;
      let stopped: Promise<boolean> | undefined;
      const agent = await agentOf(dir, counts, FIRST_RUN, { onRead: () => { stopped = ref?.stopRun(liveRun(() => ref)); } });
      ref = agent;
      const first = await agent.run(TASK);
      expect(await stopped).toBe(true);
      const runId = first.runId!;
      expect(agent.activeRunIds()).toEqual([]);
      // A user stop is an honest partial: not a success, the answer so far shipped, the stop named.
      expect(first.success).toBe(false);
      expect(first.outcome).toBe("partial");
      expect(first.metadata?.outstandingCriteria).toContain("stopped_by_request");
      expect(first.output.length).toBeGreaterThan(0);
      // `error` carries the partial's detail note, never an exception; the answer so far stays in `output`.
      expect(first.error).toContain("stopped_by_request");

      const row = await rowOf(agent, runId);
      expect(row?.status).toBe("stopped");
      expect(row?.resumable).toBe(true);
      expect(row?.stop?.kind).toBe("user-stopped");
      expect(row?.stop?.toolsDone).toContainEqual({ tool: "read-tool", calls: 1 });
      expect(row?.loopStop).toBeUndefined();
      expect(counts).toEqual({ read: 1, write: 0 });
      // The kernel's own checkpoint (one past the stop iteration) is the latest row; the fallback snapshot did not replace it.
      const ckpt = await Effect.runPromise(
        Effect.gen(function* () { return yield* (yield* RunStoreService).latestCheckpoint(runId); }).pipe(Effect.provide(RunStoreLive(join(dir, "runs.db")))),
      );
      const kernelState: unknown = JSON.parse(ckpt?.stateJson ?? "null");
      const stateIteration: unknown = typeof kernelState === "object" && kernelState !== null ? Reflect.get(Reflect.get(kernelState, "state") ?? {}, "iteration") : undefined;
      expect(ckpt?.iteration).toBe(Number(stateIteration) + 1);
      await agent.dispose();

      const second = await agentOf(dir, counts, REST);
      const result = await second.resumeRun(runId, { note: "carry on" });
      expect(result.success).toBe(true);
      expect(result.output).toContain("2026-03-01");
      expect(counts).toEqual({ read: 1, write: 1 });
      const done = await rowOf(second, runId);
      expect(done?.status).toBe("completed");
      expect(done?.stop).toBeUndefined();
      expect(done?.resumable).toBeUndefined();
      await second.dispose();
    });
  });

  it("pauseRun: status paused, resumable; resumeRun continues it", async () => {
    await withTempDir(async (dir) => {
      const counts: Counts = { read: 0, write: 0 };
      let ref: ReactiveAgent | undefined;
      let paused: Promise<boolean> | undefined;
      const agent = await agentOf(dir, counts, FIRST_RUN, { onRead: () => { paused = ref?.pauseRun(liveRun(() => ref)); } });
      ref = agent;
      const first = await agent.run(TASK);
      expect(await paused).toBe(true);
      const row = await rowOf(agent, first.runId!);
      expect(row?.status).toBe("paused");
      expect(row?.stop?.kind).toBe("user-paused");
      expect(row?.resumable).toBe(true);
      await agent.dispose();

      const second = await agentOf(dir, counts, REST);
      const result = await second.resumeRun(first.runId!);
      expect(result.success).toBe(true);
      expect(counts).toEqual({ read: 1, write: 1 });
      await second.dispose();
    });
  });

  it("a resumed run is a durable run again: it can be stopped again, then finished", async () => {
    await withTempDir(async (dir) => {
      const counts: Counts = { read: 0, write: 0 };
      let first: ReactiveAgent | undefined;
      const a1 = await agentOf(dir, counts, FIRST_RUN, { onRead: () => { void first?.stopRun(liveRun(() => first)); } });
      first = a1;
      const r1 = await a1.run(TASK);
      const runId = r1.runId!;
      await a1.dispose();

      let second: ReactiveAgent | undefined;
      const a2 = await agentOf(dir, counts, REST, { onWrite: () => { void second?.stopRun(liveRun(() => second)); } });
      second = a2;
      await a2.resumeRun(runId);
      const mid = await rowOf(a2, runId);
      expect(mid?.status).toBe("stopped");
      expect(mid?.resumable).toBe(true);
      expect(counts).toEqual({ read: 1, write: 1 });
      await a2.dispose();

      const a3 = await agentOf(dir, counts, [{ text: "FINAL ANSWER: ships 2026-03-01." }]);
      const done = await a3.resumeRun(runId);
      expect(done.success).toBe(true);
      expect(counts).toEqual({ read: 1, write: 1 });
      expect((await rowOf(a3, runId))?.status).toBe("completed");
      await a3.dispose();
    });
  });

  it("pauseRun / stopRun on an unknown id is false", async () => {
    await withTempDir(async (dir) => {
      const agent = await agentOf(dir, { read: 0, write: 0 }, []);
      expect(await agent.pauseRun("nope")).toBe(false);
      expect(await agent.stopRun("nope")).toBe(false);
      expect(agent.activeRunIds()).toEqual([]);
      await agent.dispose();
    });
  });
});

describe("a run that ended failed is resumable", () => {
  it("a spent budget: status failed, kind budget, resumable; extraIterations continues it without repeating completed tools", async () => {
    await withTempDir(async (dir) => {
      const counts: Counts = { read: 0, write: 0 };
      const script = [
        { toolCall: { name: "read-tool", args: { q: "a" } } },
        { toolCall: { name: "write-tool", args: { q: "one" } } },
        { toolCall: { name: "write-tool", args: { q: "two" } } },
        { toolCall: { name: "write-tool", args: { q: "three" } } },
        { text: "FINAL ANSWER: done." },
      ];
      const agent = await agentOf(dir, counts, script, {}, 2);
      const first = await agent.run(TASK);
      expect(first.success).toBe(false);
      const row = await rowOf(agent, first.runId!);
      expect(row?.status).toBe("failed");
      expect(row?.stop?.kind).toBe("budget");
      expect(row?.resumable).toBe(true);
      // The iteration cap hit after a think that asked for write-tool "one": that call had not run.
      expect(counts).toEqual({ read: 1, write: 0 });
      await agent.dispose();

      const second = await agentOf(dir, counts, [{ text: "FINAL ANSWER: done." }]);
      const result = await second.resumeRun(first.runId!, { extraIterations: 6 });
      expect(result.success).toBe(true);
      // The pending call runs once on resume; the completed read never repeats.
      expect(counts).toEqual({ read: 1, write: 1 });
      await second.dispose();
    });
  });

  it("resumeRun with options refuses a run that already completed", async () => {
    await withTempDir(async (dir) => {
      const agent = await agentOf(dir, { read: 0, write: 0 }, FIRST_RUN);
      const first = await agent.run(TASK);
      const error = await agent.resumeRun(first.runId!, { note: "again" }).then(() => undefined, (e: unknown) => e);
      expect(error).toMatchObject({ _tag: "RunNotResumableError", runId: first.runId });
      await agent.dispose();
    });
  });
});

describe("an error that escapes the run", () => {
  it("keeps the last noted state as the final checkpoint, marks the run failed + resumable, the failing step not done", async () => {
    await withTempDir(async (dir) => {
      const dbPath = join(dir, "runs.db");
      const runtime = ManagedRuntime.make(Layer.empty);
      const state = JSON.stringify({ codecVersion: 1, state: { taskId: "t1", iteration: 3 } });
      const build = ((_input: unknown, options?: { runState?: { runController?: RunController } }) =>
        Effect.gen(function* () {
          // The kernel notes its state each iteration; the run then dies.
          options?.runState?.runController?.noteCheckpoint?.(() => state, 3);
          return yield* Effect.fail(new Error("provider exploded"));
        })) as never;
      const rejected = await runDurableRun(
        { durableResume: { dir, configHash: "h" }, agentId: "a", runtime: runtime as never, buildRunTaskEffect: build },
        { input: TASK, runId: "r-err", task: TASK },
      ).then(() => undefined, (e: unknown) => e);
      expect(String(rejected)).toContain("provider exploded");

      const read = <A>(f: (s: RunStoreService["Type"]) => Effect.Effect<A>) =>
        Effect.runPromise(Effect.gen(function* () { return yield* f(yield* RunStoreService); }).pipe(Effect.provide(RunStoreLive(dbPath))));
      const row = await read((s) => s.getRun("r-err"));
      expect(row?.status).toBe("failed");
      expect(row?.stop).toMatchObject({ kind: "error", reason: expect.stringContaining("provider exploded") });
      expect(row?.resumable).toBe(true);
      const ckpt = await read((s) => s.latestCheckpoint("r-err"));
      expect(ckpt?.stateJson).toBe(state);
      expect(ckpt?.iteration).toBe(4);
      // A failed call is never served from the journal: resume re-runs it.
      await read((s) => s.putToolEffect({ runId: "r-err", effectId: "e1", toolName: "write-tool", toolCallId: "c1", iteration: 4, argsJson: "{}" }));
      await read((s) => s.updateToolEffectOutcome({ runId: "r-err", effectId: "e1", status: "failed", errorText: "boom" }));
      const effects = await read((s) => s.listToolEffects("r-err"));
      expect(effects.filter((e) => e.status === "succeeded")).toHaveLength(0);
      await runtime.dispose();
    });
  });
});

describe("a streamed durable run", () => {
  it("handle.stop() leaves it stopped and resumable; resume completes without repeating the read", async () => {
    await withTempDir(async (dir) => {
      const counts: Counts = { read: 0, write: 0 };
      let handle: { stop: () => void } | undefined;
      const agent = await agentOf(dir, counts, FIRST_RUN, { onRead: () => handle?.stop() });
      const h = agent.runStream(TASK);
      handle = h;
      let runId: string | undefined;
      for await (const e of h) {
        if (e._tag === "StreamCompleted") runId = e.runId;
      }
      expect(runId).toBeDefined();
      const row = await rowOf(agent, runId!);
      expect(row?.status).toBe("stopped");
      expect(row?.stop?.kind).toBe("user-stopped");
      expect(row?.resumable).toBe(true);
      expect(agent.activeRunIds()).toEqual([]);
      await agent.dispose();

      const second = await agentOf(dir, counts, REST);
      expect((await second.resumeRun(runId!)).success).toBe(true);
      expect(counts).toEqual({ read: 1, write: 1 });
      await second.dispose();
    });
  });

  it("handle.terminate() leaves it stopped (user-stopped) and resumable", async () => {
    await withTempDir(async (dir) => {
      const counts: Counts = { read: 0, write: 0 };
      let handle: { terminate: () => void } | undefined;
      const agent = await agentOf(dir, counts, FIRST_RUN, { onRead: () => handle?.terminate() });
      let runId: string | undefined;
      // A terminated stream ends with StreamCancelled (no runId on it): the id rides onRunId.
      const h = agent.runStream(TASK, { onRunId: (id) => { runId = id; } });
      handle = h;
      for await (const _ of h) { /* drain to the terminal event */ }
      expect(runId).toBeDefined();
      await new Promise((r) => setTimeout(r, 200));
      const row = await rowOf(agent, runId!);
      expect(row?.status).toBe("stopped");
      expect(row?.stop?.kind).toBe("user-stopped");
      expect(row?.resumable).toBe(true);
      await agent.dispose();
    });
  });
});

describe("the pure rules", () => {
  const base = { success: true as boolean | undefined, terminatedBy: undefined, error: undefined, loopStop: undefined, metadata: undefined };

  it("classifyEnd: a requested stop counts only when the run ended on it; loop; failure kinds; else completed", () => {
    expect(classifyEnd({ ...base, terminatedBy: "stop_requested" }, "user-paused")).toEqual({ kind: "user-paused", reason: "user-paused" });
    expect(classifyEnd({ ...base, terminatedBy: "end_turn" }, "user-stopped")).toBeUndefined();
    const loop = { reason: "loop_graceful", toolsDone: [], unfinished: [], iteration: 4 };
    expect(classifyEnd({ ...base, success: false, loopStop: loop }, undefined)).toMatchObject({ kind: "loop", stop: { kind: "loop", reason: "loop_graceful" } });
    expect(classifyEnd({ ...base, success: false, terminatedBy: "max_iterations" }, undefined)?.kind).toBe("budget");
    expect(classifyEnd({ ...base, success: false, terminatedBy: "timeout" }, undefined)?.kind).toBe("timeout");
    expect(classifyEnd({ ...base, success: false, error: "x" }, undefined)).toMatchObject({ kind: "error", reason: "x" });
    expect(classifyEnd(base, undefined)).toBeUndefined();
  });

  it("run-store resumable: non-completed with a checkpoint, never completed or waiting on a person", async () => {
    const run = (status: "running" | "completed" | "failed" | "paused" | "awaiting-approval", withCheckpoint: boolean) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const s = yield* RunStoreService;
          yield* s.createRun({ runId: "r", agentId: "a", task: "t", configHash: "h" });
          if (withCheckpoint) yield* s.putCheckpoint("r", 1, "{}");
          yield* s.setStatus("r", status);
          return (yield* s.getRun("r"))?.resumable;
        }).pipe(Effect.provide(RunStoreLive(":memory:"))),
      );
    expect(await run("running", true)).toBe(true);
    expect(await run("failed", true)).toBe(true);
    expect(await run("paused", true)).toBe(true);
    expect(await run("failed", false)).toBeUndefined();
    expect(await run("completed", true)).toBeUndefined();
    expect(await run("awaiting-approval", true)).toBeUndefined();
  });

  it("a stop record of any kind round-trips; a row from before kinds reads as a loop stop", () => {
    const json = JSON.stringify({ kind: "user-paused", reason: "user-paused", toolsDone: [], unfinished: [], iteration: 2 });
    expect(parseLoopStopSummary(json)?.kind).toBe("user-paused");
    const legacy = JSON.stringify({ reason: "loop_graceful", toolsDone: [], unfinished: [], iteration: 2 });
    expect(parseLoopStopSummary(legacy)?.kind).toBeUndefined();
  });

  it("persistInterrupt writes the snapshot one past its iteration, the record, then the status", async () => {
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const s = yield* RunStoreService;
        yield* s.createRun({ runId: "r", agentId: "a", task: "t", configHash: "h" });
        yield* s.putCheckpoint("r", 2, "old");
        yield* persistInterrupt({ runId: "r", kind: "user-stopped", reason: "user-stopped", snapshot: { serialized: "new", iteration: 2 } });
        return { ckpt: yield* s.latestCheckpoint("r"), row: yield* s.getRun("r") };
      }).pipe(Effect.provide(RunStoreLive(":memory:"))),
    );
    expect(out.ckpt).toMatchObject({ iteration: 3, stateJson: "new" });
    expect(out.row).toMatchObject({ status: "stopped", stop: { kind: "user-stopped", iteration: 2 }, resumable: true });
  });

  it("persistInterrupt keeps a newer kernel checkpoint: the fallback snapshot is written only when no row is newer", async () => {
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const s = yield* RunStoreService;
        yield* s.createRun({ runId: "r", agentId: "a", task: "t", configHash: "h" });
        yield* s.putCheckpoint("r", 3, "kernel-final");
        yield* persistInterrupt({ runId: "r", kind: "user-stopped", reason: "user-stopped", snapshot: { serialized: "noted", iteration: 2 } });
        const kept = yield* s.latestCheckpoint("r");
        yield* s.createRun({ runId: "q", agentId: "a", task: "t", configHash: "h" });
        yield* s.putCheckpoint("q", 2, "older");
        yield* persistInterrupt({ runId: "q", kind: "user-stopped", reason: "user-stopped", snapshot: { serialized: "noted", iteration: 2 } });
        return { kept, fallback: yield* s.latestCheckpoint("q") };
      }).pipe(Effect.provide(RunStoreLive(":memory:"))),
    );
    expect(out.kept).toMatchObject({ iteration: 3, stateJson: "kernel-final" });
    expect(out.fallback).toMatchObject({ iteration: 3, stateJson: "noted" });
  });

  it("classifyEnd: a user stop is read from the kernel's terminal outcome even on a failed result", () => {
    const outcome = { extensions: { terminalOutcome: { terminatedBy: "stop_requested" } } } as never;
    expect(classifyEnd({ success: false, terminatedBy: "end_turn", metadata: outcome }, "user-stopped")).toEqual({ kind: "user-stopped", reason: "user-stopped" });
    expect(classifyEnd({ success: false, terminatedBy: "end_turn", metadata: outcome }, undefined)?.kind).toBe("error");
  });

  it("prepareResume: user stop adds a plain continue; error adds nothing; the note and cap pass through", () => {
    const stateJson = "not-a-kernel-state";
    expect(prepareResume({ stateJson, goal: "g" })).toEqual({ stateJson });
    expect(prepareResume({ stateJson, goal: "g", stop: { kind: "user-stopped", reason: "x", toolsDone: [], unfinished: [], iteration: 1 } })).toEqual({ stateJson });
  });

  it("the live registry reaches a run by id and resolves its request when the run is released", async () => {
    const live = makeActiveRuns();
    const controller = new RunController(new AbortController());
    const release = live.register("r1", controller);
    expect(live.ids()).toEqual(["r1"]);
    let resolved = false;
    const asked = live.request("r1", "user-paused").then((ok) => { resolved = ok; });
    expect(controller.requestedStop()).toBe("user-paused");
    await Promise.resolve();
    expect(resolved).toBe(false);
    release();
    await asked;
    expect(resolved).toBe(true);
    expect(live.ids()).toEqual([]);
    expect(await live.request("r1", "user-stopped")).toBe(false);
  });
});

describe("checkpoint wrapper overhead (zero-token timing note)", () => {
  it("the per-iteration cost added to the hot path is one closure call", async () => {
    const N = 200_000;
    const noop = (): string => "s";
    const bare = new RunController(new AbortController());
    const t0 = performance.now();
    for (let i = 0; i < N; i++) bare.noteCheckpoint(noop, i);
    const bareMs = performance.now() - t0;

    const wrapped = new RunController(new AbortController());
    installDurableCheckpointing(wrapped, { runId: "r", runStoreLayer: RunStoreLive(":memory:"), checkpointEvery: 1 });
    const t1 = performance.now();
    for (let i = 0; i < N; i++) wrapped.noteCheckpoint(noop, i);
    const wrappedMs = performance.now() - t1;
    console.log(`[overhead] noteCheckpoint x${N}: bare ${bareMs.toFixed(2)}ms, wrapped ${wrappedMs.toFixed(2)}ms, +${(((wrappedMs - bareMs) / N) * 1000).toFixed(3)}us/call`);
    // Two noteCheckpoint calls per iteration: far under 1% of any LLM call.
    expect((wrappedMs - bareMs) / N).toBeLessThan(0.01);
  });
});
