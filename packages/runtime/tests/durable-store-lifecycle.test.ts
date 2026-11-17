// Run: bun test packages/runtime/tests/durable-store-lifecycle.test.ts --timeout 15000
//
// Durable RunStore lifecycle:
//   - every RunStoreLive layer closes its SQLite handle when its scope ends
//     (listDurableRuns opened one handle per call and never closed it: a leak in
//     any long-running host that polls the store, e.g. Cortex crash recovery);
//   - defaultDurableRunsDir is the one resolver for the default durable dir.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import { existsSync, mkdtempSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { listDurableRuns } from "../src/engine/durable-resume.js";
import { RunStoreLive, RunStoreService, defaultDurableRunsDir } from "../src/services/run-store.js";

/** Open file descriptors of this process that point at `path` (Linux /proc). */
const openHandlesTo = (path: string): number =>
  readdirSync("/proc/self/fd").filter((fd) => {
    try {
      return readlinkSync(`/proc/self/fd/${fd}`) === path;
    } catch {
      return false;
    }
  }).length;

const hasProcFd = existsSync("/proc/self/fd");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ra-durable-lifecycle-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("RunStoreLive handle lifecycle", () => {
  it.skipIf(!hasProcFd)("listDurableRuns closes its database", async () => {
    const dbPath = join(dir, "runs.db");
    await Effect.runPromise(listDurableRuns({ dbPath }));
    const before = openHandlesTo(dbPath);
    for (let i = 0; i < 5; i++) {
      await Effect.runPromise(listDurableRuns({ dbPath }));
    }
    expect(before).toBe(0);
    expect(openHandlesTo(dbPath)).toBe(0);
  });

  it.skipIf(!hasProcFd)("a RunStoreLive layer keeps its handle open for the scope, then closes it", async () => {
    const dbPath = join(dir, "runs.db");
    const openInside = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r1", agentId: "a", task: "t", configHash: "h" });
        return openHandlesTo(dbPath);
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );
    expect(openInside).toBeGreaterThan(0);
    expect(openHandlesTo(dbPath)).toBe(0);
    // The data survived the close.
    const runs = await Effect.runPromise(listDurableRuns({ dbPath }));
    expect(runs.map((r) => r.runId)).toEqual(["r1"]);
  });
});

describe("defaultDurableRunsDir", () => {
  const ENV = "REACTIVE_AGENTS_RUNS_DIR";
  const saved = process.env[ENV];
  const withEnv = (value: string | undefined, f: () => void): void => {
    if (value === undefined) delete process.env[ENV];
    else process.env[ENV] = value;
    try {
      f();
    } finally {
      if (saved === undefined) delete process.env[ENV];
      else process.env[ENV] = saved;
    }
  };

  it("is ~/.reactive-agents/<agentId> by default", () => {
    withEnv(undefined, () => {
      expect(defaultDurableRunsDir("agent-7")).toBe(join(homedir(), ".reactive-agents", "agent-7"));
    });
  });

  it("explicit home beats REACTIVE_AGENTS_RUNS_DIR; env applies only when home is omitted", () => {
    withEnv("/tmp/ra-env-base", () => {
      expect(defaultDurableRunsDir("agent-7", "/srv/home")).toBe(join("/srv/home", ".reactive-agents", "agent-7"));
      expect(defaultDurableRunsDir("agent-7")).toBe(join("/tmp/ra-env-base", "agent-7"));
      expect(defaultDurableRunsDir("../x")).toBe(join("/tmp/ra-env-base", "..%2Fx"));
    });
  });

  it("takes a home override", () => {
    expect(defaultDurableRunsDir("agent-7", "/srv/home")).toBe(join("/srv/home", ".reactive-agents", "agent-7"));
  });
});
