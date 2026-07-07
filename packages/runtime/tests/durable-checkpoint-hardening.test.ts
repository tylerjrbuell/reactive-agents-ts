/**
 * durable-checkpoint-hardening.test.ts — Arc 1 Task 4.
 *
 * Live-probe P3 finding: checkpoint writes were fire-and-forget
 * (`Effect.runFork`), so a crash immediately after an iteration could lose
 * the last checkpoint silently. Proves the fix: `installDurableCheckpointing`
 * now exposes an awaitable `flush()` that guarantees every write started so
 * far is durable before it resolves — the gate Task 6 (agent.fork reading the
 * latest checkpoint) depends on.
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { RunController, installDurableCheckpointing } from "../src/run-controller.js";
import { RunStoreLive, RunStoreService } from "../src/services/run-store.js";

describe("durable checkpoint hardening", () => {
  test("flush() guarantees the last checkpoint is durable before returning", async () => {
    const dbPath = `/tmp/claude-1000/hardening-${Date.now()}.db`;
    const layer = RunStoreLive(dbPath);
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r1", agentId: "a", task: "t", configHash: "h" });
      }).pipe(Effect.provide(layer)),
    );
    const controller = new RunController(new AbortController());
    const { flush } = installDurableCheckpointing(controller, {
      runId: "r1",
      runStoreLayer: layer,
      checkpointEvery: 1,
    });
    controller.onCheckpoint!('{"codecVersion":1,"state":{}}', 1);
    await flush();
    const row = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        return yield* store.latestCheckpoint("r1");
      }).pipe(Effect.provide(layer)),
    );
    expect(row?.iteration).toBe(1);
  });

  test("flush() resolves immediately (no-op) when nothing is in flight", async () => {
    const dbPath = `/tmp/claude-1000/hardening-noop-${Date.now()}.db`;
    const layer = RunStoreLive(dbPath);
    const controller = new RunController(new AbortController());
    const { flush } = installDurableCheckpointing(controller, {
      runId: "r-noop",
      runStoreLayer: layer,
      checkpointEvery: 1,
    });
    // No onCheckpoint call — nothing in flight. flush() must still resolve.
    await expect(flush()).resolves.toBeUndefined();
  });

  test("finish() awaits flush() before writing the terminal status", async () => {
    const dbPath = `/tmp/claude-1000/hardening-finish-${Date.now()}.db`;
    const layer = RunStoreLive(dbPath);
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r2", agentId: "a", task: "t", configHash: "h" });
      }).pipe(Effect.provide(layer)),
    );
    const controller = new RunController(new AbortController());
    const { finish } = installDurableCheckpointing(controller, {
      runId: "r2",
      runStoreLayer: layer,
      checkpointEvery: 1,
    });
    controller.onCheckpoint!('{"codecVersion":1,"state":{}}', 1);
    await finish(true);
    const { run, checkpoint } = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        return {
          run: yield* store.getRun("r2"),
          checkpoint: yield* store.latestCheckpoint("r2"),
        };
      }).pipe(Effect.provide(layer)),
    );
    expect(run?.status).toBe("completed");
    expect(checkpoint?.iteration).toBe(1);
  });
});

describe("inert durable-config warning", () => {
  test("warns once when .withDurableRuns() is set without .withReasoning()", async () => {
    const { ReactiveAgents } = await import("../src/builder.js");
    const dir = `/tmp/claude-1000/hardening-warn-${Date.now()}`;
    const calls: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      const agent = await ReactiveAgents.create()
        .withName("inert-durable")
        .withDurableRuns({ dir })
        .build();
      await agent.dispose();
    } finally {
      console.warn = original;
    }
    expect(calls.length).toBe(1);
    expect(String(calls[0]?.[0])).toContain(".withDurableRuns() is configured but the run will NOT checkpoint");
    expect(String(calls[0]?.[0])).toContain(".withReasoning()");
  });

  test("does not warn when .withDurableRuns() is paired with .withReasoning()", async () => {
    const { ReactiveAgents } = await import("../src/builder.js");
    const dir = `/tmp/claude-1000/hardening-nowarn-${Date.now()}`;
    const calls: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      const agent = await ReactiveAgents.create()
        .withName("wired-durable")
        .withReasoning()
        .withDurableRuns({ dir })
        .build();
      await agent.dispose();
    } finally {
      console.warn = original;
    }
    const inertWarning = calls.find((args) =>
      String(args[0]).includes(".withDurableRuns() is configured but the run will NOT checkpoint"),
    );
    expect(inertWarning).toBeUndefined();
  });
});
