import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { RunStoreLive, RunStoreService } from "@reactive-agents/runtime";
import { collectRuns } from "../src/commands/ps.js";

describe("rax ps", () => {
  test("collects runs across db paths with status filter", async () => {
    const dbPath = `/tmp/claude-1000/ps-${Date.now()}.db`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r-live", agentId: "a", task: "long task", configHash: "h" });
        yield* store.createRun({ runId: "r-done", agentId: "a", task: "done task", configHash: "h" });
        yield* store.setStatus("r-done", "completed");
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );
    const active = await collectRuns([dbPath], { all: false });
    expect(active.map((r) => r.runId)).toEqual(["r-live"]);
    const all = await collectRuns([dbPath], { all: true });
    expect(all).toHaveLength(2);
  });

  test("default filter excludes every terminal status, --all includes them", async () => {
    const dbPath = `/tmp/claude-1000/ps-terminal-${Date.now()}.db`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r-running", agentId: "a", task: "t", configHash: "h" });
        yield* store.createRun({ runId: "r-paused", agentId: "a", task: "t", configHash: "h" });
        yield* store.setStatus("r-paused", "paused");
        yield* store.createRun({ runId: "r-awaiting-approval", agentId: "a", task: "t", configHash: "h" });
        yield* store.setStatus("r-awaiting-approval", "awaiting-approval");
        yield* store.createRun({ runId: "r-awaiting-interaction", agentId: "a", task: "t", configHash: "h" });
        yield* store.setStatus("r-awaiting-interaction", "awaiting-interaction");
        yield* store.createRun({ runId: "r-completed", agentId: "a", task: "t", configHash: "h" });
        yield* store.setStatus("r-completed", "completed");
        yield* store.createRun({ runId: "r-failed", agentId: "a", task: "t", configHash: "h" });
        yield* store.setStatus("r-failed", "failed");
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );
    const active = await collectRuns([dbPath], { all: false });
    expect(new Set(active.map((r) => r.runId))).toEqual(
      new Set(["r-running", "r-paused", "r-awaiting-approval", "r-awaiting-interaction"]),
    );
    const all = await collectRuns([dbPath], { all: true });
    expect(all).toHaveLength(6);
  });

  test("surfaces fork lineage when present", async () => {
    const dbPath = `/tmp/claude-1000/ps-fork-${Date.now()}.db`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({
          runId: "r-fork",
          agentId: "a",
          task: "t",
          configHash: "h",
          forkedFrom: "r-parent",
          forkedAtIteration: 3,
        });
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );
    const rows = await collectRuns([dbPath], { all: false });
    expect(rows[0]?.forkedFrom).toBe("r-parent");
    expect(rows[0]?.forkedAtIteration).toBe(3);
  });
});
