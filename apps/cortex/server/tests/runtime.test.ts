import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createCortexRuntime } from "../runtime.js";
import { CortexIngestService } from "../services/ingest-service.js";
import { CortexStoreService } from "../services/store-service.js";
import { CortexRunnerService } from "../services/runner-service.js";

describe("createCortexRuntime", () => {
  let dir: string | undefined;
  let closeDb: (() => void) | undefined;

  afterEach(() => {
    closeDb?.();
    closeDb = undefined;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("creates DB on disk, applies schema, and shares sqlite across ingest and store layers", async () => {
    dir = mkdtempSync(join(tmpdir(), "cortex-rt-"));
    const dbPath = join(dir, "nested", "cortex.db");
    const rt = createCortexRuntime({
      port: 0,
      dbPath,
      openBrowser: false,
    });
    closeDb = () => rt.db.close();

    const tables = rt.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("cortex_runs");

    await Effect.runPromise(
      Effect.gen(function* () {
        const ingest = yield* CortexIngestService;
        yield* ingest.handleEvent("rt-a", "rt-run", {
          v: 1,
          agentId: "rt-a",
          runId: "rt-run",
          event: { _tag: "TaskCreated", taskId: "t" },
        });
      }).pipe(Effect.provide(rt.ingestLayer)),
    );

    const runs = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* CortexStoreService;
        return yield* store.getRecentRuns(10);
      }).pipe(Effect.provide(rt.storeLayer)),
    );

    expect(runs.some((r) => r.runId === "rt-run")).toBe(true);
  });

  it("runnerLayer is a shared singleton so runtime controls reach the running agent's registry", async () => {
    dir = mkdtempSync(join(tmpdir(), "cortex-rt-"));
    const rt = createCortexRuntime({
      port: 0,
      dbPath: join(dir, "cortex.db"),
      openBrowser: false,
    });
    closeDb = () => rt.db.close();

    const getSvc = Effect.gen(function* () {
      return yield* CortexRunnerService;
    });

    // Each HTTP handler resolves the runner via `Effect.provide(rt.runnerLayer)`.
    // The desk-run registry (`activeRef`) is in-memory state that lives INSIDE the
    // service instance. POST /api/runs registers the agent; POST /:runId/pause must
    // find it. If the layer rebuilds a fresh instance per request, the two have
    // separate (empty) registries and controls silently no-op. Same instance across
    // independent resolutions ⇒ shared registry ⇒ controls reach the running agent.
    const a = await Effect.runPromise(getSvc.pipe(Effect.provide(rt.runnerLayer)));
    const b = await Effect.runPromise(getSvc.pipe(Effect.provide(rt.runnerLayer)));
    expect(a).toBe(b);
  });
});
