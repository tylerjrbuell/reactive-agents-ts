import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { RunStoreLive, RunStoreService } from "@reactive-agents/runtime";
import { findRun } from "../src/commands/attach.js";

describe("rax attach", () => {
  test("finds a run + its latest checkpoint iteration across db paths", async () => {
    const dbPath = `/tmp/claude-1000/attach-${Date.now()}.db`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r-1", agentId: "a", task: "t", configHash: "h" });
        yield* store.putCheckpoint("r-1", 1, "{}");
        yield* store.putCheckpoint("r-1", 2, "{}");
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );

    const snapshot = await findRun(["/tmp/claude-1000/does-not-exist.db", dbPath], "r-1");
    expect(snapshot?.run.runId).toBe("r-1");
    expect(snapshot?.run.status).toBe("running");
    expect(snapshot?.iteration).toBe(2);
    expect(snapshot?.db).toBe(dbPath);
  });

  test("returns undefined when the run isn't in any scanned db", async () => {
    const dbPath = `/tmp/claude-1000/attach-empty-${Date.now()}.db`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r-other", agentId: "a", task: "t", configHash: "h" });
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );

    const snapshot = await findRun([dbPath], "r-missing");
    expect(snapshot).toBeUndefined();
  });

  test("detects the terminal status a caller would stop on", async () => {
    const dbPath = `/tmp/claude-1000/attach-terminal-${Date.now()}.db`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r-done", agentId: "a", task: "t", configHash: "h" });
        yield* store.setStatus("r-done", "completed");
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );

    const snapshot = await findRun([dbPath], "r-done");
    expect(snapshot?.run.status).toBe("completed");
  });
});
