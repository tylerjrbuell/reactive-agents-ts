import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { RunStoreService, RunStoreLive } from "../../src/services/run-store.js";

const inMem = RunStoreLive(":memory:");

describe("RunStoreService", () => {
  it("creates a run, writes checkpoints, reads the latest", async () => {
    const prog = Effect.gen(function* () {
      const store = yield* RunStoreService;
      yield* store.createRun({ runId: "r1", agentId: "a", task: "t", configHash: "h" });
      yield* store.putCheckpoint("r1", 2, '{"v":1,"iteration":2}');
      yield* store.putCheckpoint("r1", 4, '{"v":1,"iteration":4}');
      const latest = yield* store.latestCheckpoint("r1");
      const run = yield* store.getRun("r1");
      return { latest, run };
    });
    const { latest, run } = await Effect.runPromise(prog.pipe(Effect.provide(inMem)));
    expect(latest?.iteration).toBe(4);
    expect(latest?.stateJson).toContain('"iteration":4');
    expect(run?.status).toBe("running");
  });

  it("upserts a checkpoint idempotently on the same iteration", async () => {
    const prog = Effect.gen(function* () {
      const store = yield* RunStoreService;
      yield* store.createRun({ runId: "r2", agentId: "a", task: "t", configHash: "h" });
      yield* store.putCheckpoint("r2", 3, '{"v":1,"first":true}');
      yield* store.putCheckpoint("r2", 3, '{"v":1,"second":true}');
      return yield* store.latestCheckpoint("r2");
    });
    const latest = await Effect.runPromise(prog.pipe(Effect.provide(inMem)));
    expect(latest?.iteration).toBe(3);
    expect(latest?.stateJson).toContain('"second":true');
  });

  it("setStatus transitions a run to a terminal state", async () => {
    const prog = Effect.gen(function* () {
      const store = yield* RunStoreService;
      yield* store.createRun({ runId: "r3", agentId: "a", task: "t", configHash: "h" });
      yield* store.setStatus("r3", "completed");
      return yield* store.getRun("r3");
    });
    const run = await Effect.runPromise(prog.pipe(Effect.provide(inMem)));
    expect(run?.status).toBe("completed");
  });

  it("returns undefined for unknown run", async () => {
    const r = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* RunStoreService).latestCheckpoint("nope");
      }).pipe(Effect.provide(inMem)),
    );
    expect(r).toBeUndefined();
  });

  it("returns undefined when getting an unknown run", async () => {
    const r = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* RunStoreService).getRun("nope");
      }).pipe(Effect.provide(inMem)),
    );
    expect(r).toBeUndefined();
  });

  it("putApproval then getPendingApproval returns the pending row", async () => {
    const prog = Effect.gen(function* () {
      const store = yield* RunStoreService;
      yield* store.createRun({ runId: "ap1", agentId: "a", task: "t", configHash: "h" });
      yield* store.putApproval({
        runId: "ap1", gateId: "g1", toolName: "shell-execution",
        argsJson: '{"cmd":"rm -rf /tmp/x"}',
      });
      return yield* store.getPendingApproval("ap1");
    });
    const rec = await Effect.runPromise(prog.pipe(Effect.provide(inMem)));
    expect(rec?.gateId).toBe("g1");
    expect(rec?.toolName).toBe("shell-execution");
    expect(rec?.status).toBe("pending");
  });

  it("decideApproval flips a pending row and blocks double-decide", async () => {
    const prog = Effect.gen(function* () {
      const store = yield* RunStoreService;
      yield* store.createRun({ runId: "ap2", agentId: "a", task: "t", configHash: "h" });
      yield* store.putApproval({ runId: "ap2", gateId: "g2", toolName: "docker", argsJson: "{}" });
      const first = yield* store.decideApproval("ap2", "g2", "approved");
      const pendingAfter = yield* store.getPendingApproval("ap2");
      const second = yield* store.decideApproval("ap2", "g2", "denied", "too late");
      return { first, pendingAfter, second };
    });
    const { first, pendingAfter, second } = await Effect.runPromise(prog.pipe(Effect.provide(inMem)));
    expect(first).toBe(true);
    expect(pendingAfter).toBeUndefined();
    expect(second).toBe(false);
  });
});
