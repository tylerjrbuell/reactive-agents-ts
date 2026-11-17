// Run: bun test packages/runtime/tests/durable-retention.test.ts --timeout 15000
//
// Durable RunStore retention + REACTIVE_AGENTS_RUNS_DIR override.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RunStoreLive, RunStoreService, defaultDurableRunsDir, type RunStatus } from "../src/services/run-store.js";
import { DEFAULT_DURABLE_RETENTION, resolveRetention } from "../src/services/run-store-retention.js";

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ra-retention-"));
  dbPath = join(dir, "runs.db");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const DAY = 86_400_000;

/** Seed a run with `iterations` checkpoints, one effect and one event. */
const seed = (runId: string, status: RunStatus, iterations = 3) =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    yield* store.createRun({ runId, agentId: "a", task: "t", configHash: "h" });
    for (let i = 1; i <= iterations; i++) yield* store.putCheckpoint(runId, i, "x".repeat(2000));
    yield* store.putToolEffect({ runId, effectId: "e1", toolName: "t", toolCallId: "c", iteration: 1, argsJson: "{}" });
    yield* store.appendRunEvent(runId, 1, "{}");
    yield* store.setStatus(runId, status);
  });

const run = <A>(e: Effect.Effect<A, never, RunStoreService>): Promise<A> =>
  Effect.runPromise(e.pipe(Effect.provide(RunStoreLive(dbPath))));

describe("durable retention", () => {
  it("never prunes resumable or active runs, however old or numerous", async () => {
    const out = await run(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        for (const [id, st] of [
          ["running", "running"],
          ["stopped", "stopped"],
          ["paused", "paused"],
          ["failed", "failed"],
          ["await-a", "awaiting-approval"],
          ["await-i", "awaiting-interaction"],
        ] as const) {
          yield* seed(id, st);
        }
        const res = yield* store.prune({ keepCompleted: 1, maxAgeDays: 1 });
        const runs = yield* store.listRuns();
        const cps = yield* store.latestCheckpoint("stopped");
        const effects = yield* store.listToolEffects("running");
        return { res, ids: runs.map((r) => r.runId).sort(), cps, effects };
      }),
    );
    expect(out.res).toEqual({ runsDeleted: 0, runsCompacted: 0 });
    expect(out.ids).toEqual(["await-a", "await-i", "failed", "paused", "running", "stopped"]);
    expect(out.cps?.iteration).toBe(3);
    expect(out.effects.length).toBe(1);
  });

  it("compacts a completed run to its final checkpoint and drops its effects", async () => {
    const out = await run(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* seed("done", "completed", 4);
        const res = yield* store.prune();
        return {
          res,
          first: yield* store.checkpointAt("done", 3),
          last: yield* store.latestCheckpoint("done"),
          effects: yield* store.listToolEffects("done"),
          run: yield* store.getRun("done"),
        };
      }),
    );
    expect(out.res?.runsCompacted).toBe(1);
    expect(out.first).toBeUndefined();
    expect(out.last?.iteration).toBe(4);
    expect(out.effects).toEqual([]);
    expect(out.run?.status).toBe("completed");
  });

  it("compactCheckpoints:false keeps every checkpoint", async () => {
    const cp = await run(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* seed("done", "completed", 3);
        yield* store.prune({ compactCheckpoints: false });
        return yield* store.checkpointAt("done", 1);
      }),
    );
    expect(cp?.iteration).toBe(1);
  });

  it("keepCompleted deletes the oldest completed runs, keeps the newest", async () => {
    const ids = await run(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        for (let i = 0; i < 5; i++) {
          yield* seed(`c${i}`, "completed", 1);
          yield* Effect.promise(() => new Promise((r) => setTimeout(r, 3)));
        }
        const res = yield* store.prune({ keepCompleted: 2 });
        expect(res?.runsDeleted).toBe(3);
        return (yield* store.listRuns()).map((r) => r.runId).sort();
      }),
    );
    expect(ids).toEqual(["c3", "c4"]);
  });

  it("maxAgeDays deletes old completed runs and all their rows (injected clock)", async () => {
    const { pruneRunStoreDb } = await import("../src/services/run-store-retention.js");
    const { Database } = await import("@reactive-agents/runtime-shim");
    await run(seed("old", "completed", 2));
    const db = new Database(dbPath);
    const res = pruneRunStoreDb(db, { maxAgeDays: 1 }, Date.now() + 2 * DAY);
    const left = db.query("SELECT COUNT(*) AS n FROM runs").get() as { n: number };
    const cps = db.query("SELECT COUNT(*) AS n FROM run_checkpoints").get() as { n: number };
    db.close();
    expect(res.runsDeleted).toBe(1);
    expect(left.n).toBe(0);
    expect(cps.n).toBe(0);
  });

  it("a pruned finished run is simply unknown: getRun undefined, no checkpoint to resume", async () => {
    const out = await run(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* seed("c0", "completed", 2);
        yield* Effect.promise(() => new Promise((r) => setTimeout(r, 3)));
        yield* seed("c1", "completed", 2);
        yield* store.prune({ keepCompleted: 1 });
        return { run: yield* store.getRun("c0"), cp: yield* store.latestCheckpoint("c0") };
      }),
    );
    expect(out.run).toBeUndefined();
    expect(out.cp).toBeUndefined();
  });

  it("never throws: a broken store yields undefined", async () => {
    const res = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        return yield* store.prune();
      }).pipe(Effect.provide(RunStoreLive(":memory:"))),
    );
    expect(res).toEqual({ runsDeleted: 0, runsCompacted: 0 });
  });

  it("resolveRetention applies bounded defaults and ignores junk", () => {
    expect(resolveRetention(undefined)).toEqual(DEFAULT_DURABLE_RETENTION);
    expect(resolveRetention({ keepCompleted: -3, maxAgeDays: Number.NaN }).keepCompleted).toBe(50);
    expect(resolveRetention({ keepCompleted: 0 }).keepCompleted).toBe(0);
  });
});

describe("REACTIVE_AGENTS_RUNS_DIR", () => {
  const prev = process.env["REACTIVE_AGENTS_RUNS_DIR"];
  afterEach(() => {
    if (prev === undefined) delete process.env["REACTIVE_AGENTS_RUNS_DIR"];
    else process.env["REACTIVE_AGENTS_RUNS_DIR"] = prev;
  });

  it("replaces <home>/.reactive-agents and keeps the agent id contained", () => {
    process.env["REACTIVE_AGENTS_RUNS_DIR"] = join(dir, "base");
    expect(defaultDurableRunsDir("agent-1", "/home/x")).toBe(join(resolve(dir, "base"), "agent-1"));
    expect(defaultDurableRunsDir("../evil", "/home/x").startsWith(join(resolve(dir, "base"), ""))).toBe(true);
    expect(defaultDurableRunsDir("../evil", "/home/x")).toBe(join(resolve(dir, "base"), "..%2Fevil"));
  });

  it("empty value falls back to home", () => {
    process.env["REACTIVE_AGENTS_RUNS_DIR"] = "";
    expect(defaultDurableRunsDir("a", "/home/x")).toBe(join("/home/x", ".reactive-agents", "a"));
  });
});

describe("size measurement: 10-turn tool session", () => {
  it("bounds runs.db growth", async () => {
    const turn = (i: number) =>
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        const id = `turn-${i}`;
        yield* store.createRun({ runId: id, agentId: "a", task: "t", configHash: "h" });
        for (let it = 1; it <= 3; it++) yield* store.putCheckpoint(id, it, "s".repeat(100_000));
        yield* store.setStatus(id, "completed");
      });
    const sizeAfter = async (retention: { keepCompleted?: number } | undefined, prune: boolean) => {
      const p = join(dir, `size-${prune}.db`);
      for (let i = 0; i < 10; i++) {
        await Effect.runPromise(
          Effect.gen(function* () {
            const store = yield* RunStoreService;
            if (prune) yield* store.prune(retention);
            yield* turn(i);
          }).pipe(Effect.provide(RunStoreLive(p))),
        );
      }
      await Effect.runPromise(Effect.flatMap(RunStoreService, (s) => (prune ? s.prune(retention) : Effect.void)).pipe(Effect.provide(RunStoreLive(p))));
      return statSync(p).size;
    };
    const before = await sizeAfter(undefined, false);
    const after = await sizeAfter(undefined, true);
    console.log(`runs.db 10 turns: before=${before} bytes, after(default retention)=${after} bytes`);
    expect(after).toBeLessThan(before);
  });
});
