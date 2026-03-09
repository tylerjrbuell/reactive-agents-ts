import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  ExperienceStore,
  ExperienceStoreLive,
} from "../../src/services/experience-store.js";
import type { ExperienceRecord } from "../../src/services/experience-store.js";
import { MemoryDatabaseLive } from "../../src/database.js";
import { defaultMemoryConfig } from "../../src/types.js";
import * as fs from "node:fs";

const TEST_DB = "/tmp/test-experience-store.db";

const makeRecord = (overrides: Partial<ExperienceRecord> = {}): ExperienceRecord => ({
  agentId: "agent-a",
  taskDescription: "Write and run a data analysis script",
  taskType: "data-analysis",
  toolsUsed: ["file-write", "code-execute"],
  success: true,
  totalSteps: 5,
  totalTokens: 1200,
  errors: [],
  modelTier: "mid",
  ...overrides,
});

const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
const dbLayer = MemoryDatabaseLive(config);
const serviceLayer = ExperienceStoreLive.pipe(Layer.provide(dbLayer));

const run = <A, E>(effect: Effect.Effect<A, E, ExperienceStore>) =>
  Effect.runPromise(
    Effect.scoped(effect.pipe(Effect.provide(serviceLayer))),
  );

describe("ExperienceStore", () => {
  afterEach(() => {
    try {
      fs.unlinkSync(TEST_DB);
      fs.unlinkSync(TEST_DB + "-wal");
      fs.unlinkSync(TEST_DB + "-shm");
    } catch {
      /* ignore */
    }
  });

  it("records tool patterns from a completed run", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ExperienceStore;

        // Record the same pattern twice so it meets the occurrences >= 2 threshold
        yield* svc.record(makeRecord());
        yield* svc.record(makeRecord());

        return yield* svc.query(
          "data analysis task",
          "data-analysis",
          "mid",
        );
      }),
    );

    expect(result.toolPatterns.length).toBe(1);
    const pattern = result.toolPatterns[0]!;
    expect(pattern.taskType).toBe("data-analysis");
    expect(pattern.pattern).toEqual(["file-write", "code-execute"]);
    expect(pattern.successRate).toBe(1.0);
    expect(pattern.occurrences).toBe(2);
    expect(pattern.avgSteps).toBe(5);
    expect(pattern.avgTokens).toBe(1200);
  });

  it("records and retrieves error recoveries", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ExperienceStore;

        yield* svc.record(
          makeRecord({
            success: false,
            errors: [
              {
                tool: "file-write",
                error: "ENOENT: no such file or directory",
                recovery: "Create the parent directory first with mkdir -p",
              },
            ],
          }),
        );

        return yield* svc.query("write files", "data-analysis", "mid");
      }),
    );

    expect(result.errorRecoveries.length).toBe(1);
    const recovery = result.errorRecoveries[0]!;
    expect(recovery.tool).toBe("file-write");
    expect(recovery.errorPattern).toBe("ENOENT: no such file or directory");
    expect(recovery.recovery).toBe(
      "Create the parent directory first with mkdir -p",
    );
    expect(recovery.occurrences).toBe(1);
  });

  it("only returns experiences with confidence >= 0.5 and occurrences >= 2", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ExperienceStore;

        // Only one occurrence — should NOT appear in toolPatterns
        yield* svc.record(makeRecord());

        return yield* svc.query("data analysis", "data-analysis", "mid");
      }),
    );

    // With only 1 occurrence, the confidence filter passes (1.0 >= 0.5) but
    // occurrences < 2, so toolPatterns should be empty
    expect(result.toolPatterns.length).toBe(0);
  });

  it("cross-agent: Agent B sees Agent A patterns", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ExperienceStore;

        // Agent A records two successful runs
        yield* svc.record(makeRecord({ agentId: "agent-a" }));
        yield* svc.record(makeRecord({ agentId: "agent-a" }));

        // Agent B queries the same taskType
        return yield* svc.query(
          "run data analysis",
          "data-analysis",
          "mid",
        );
      }),
    );

    // Agent B should see Agent A's patterns because they are stored by taskType
    expect(result.toolPatterns.length).toBe(1);
    expect(result.toolPatterns[0]!.taskType).toBe("data-analysis");
    expect(result.toolPatterns[0]!.occurrences).toBe(2);
  });
});
