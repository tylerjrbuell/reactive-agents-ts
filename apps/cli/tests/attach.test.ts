import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { RunStoreLive, RunStoreService } from "@reactive-agents/runtime";
import { attachCommand, findRun, parseAttachArgs } from "../src/commands/attach.js";

describe("rax attach arg parsing", () => {
  test("takes the positional runId even when --db precedes it", () => {
    const parsed = parseAttachArgs(["--db", "/tmp/x.db", "r-123"]);
    expect(parsed.runId).toBe("r-123");
    expect(parsed.db).toBe("/tmp/x.db");
    expect(parsed.error).toBeUndefined();
  });

  test("positional-first order still works", () => {
    const parsed = parseAttachArgs(["r-123", "--db", "/tmp/x.db"]);
    expect(parsed.runId).toBe("r-123");
    expect(parsed.db).toBe("/tmp/x.db");
  });

  test("errors when --db has no value or would swallow another flag", () => {
    expect(parseAttachArgs(["r-123", "--db"]).error).toContain("--db requires");
    expect(parseAttachArgs(["--db", "--some-flag", "r-123"]).error).toContain("--db requires");
  });

  test("errors when no runId is given", () => {
    expect(parseAttachArgs([]).error).toContain("Usage:");
    expect(parseAttachArgs(["--db", "/tmp/x.db"]).error).toContain("Usage:");
  });
});

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

  test("never-found runId exits with code 1 after bounded attempts (no infinite poll)", async () => {
    const dbPath = `/tmp/claude-1000/attach-notfound-${Date.now()}.db`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r-exists", agentId: "a", task: "t", configHash: "h" });
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );

    const prevExitCode = process.exitCode;
    try {
      process.exitCode = 0;
      // Fast test knobs: 5ms poll, 3 attempts — production defaults are 1s / 10.
      await attachCommand(["--db", dbPath, "r-typo"], { pollMs: 5, notFoundAttempts: 3 });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = prevExitCode ?? 0;
    }
  });

  test("attaches straight to a terminal run and returns without error (flag-before-positional)", async () => {
    const dbPath = `/tmp/claude-1000/attach-e2e-${Date.now()}.db`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r-done", agentId: "a", task: "t", configHash: "h" });
        yield* store.setStatus("r-done", "completed");
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );

    const prevExitCode = process.exitCode;
    try {
      process.exitCode = 0;
      // --db BEFORE the positional: regression guard for the old
      // `args.find(!startsWith("--"))` parsing that grabbed the db path as runId.
      await attachCommand(["--db", dbPath, "r-done"], { pollMs: 5, notFoundAttempts: 3 });
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = prevExitCode ?? 0;
    }
  });
});
