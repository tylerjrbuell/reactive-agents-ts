import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  ProceduralMemoryService,
  ProceduralMemoryServiceLive,
  MemoryDatabaseLive,
} from "../src/index.js";
import type { ProceduralEntry, MemoryId } from "../src/types.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-procedural-db";
const TEST_DB = path.join(TEST_DB_DIR, "procedural.db");

const makeWorkflow = (
  id: string,
  name: string,
  tags: string[] = [],
): ProceduralEntry => ({
  id: id as MemoryId,
  agentId: "test-agent",
  name,
  description: `Workflow: ${name}`,
  pattern: JSON.stringify({ steps: ["step1", "step2"] }),
  successRate: 0.8,
  useCount: 5,
  tags,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("ProceduralMemoryService", () => {
  afterEach(() => {
    try {
      fs.unlinkSync(TEST_DB);
      fs.unlinkSync(TEST_DB + "-wal");
      fs.unlinkSync(TEST_DB + "-shm");
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(TEST_DB_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
  const dbLayer = MemoryDatabaseLive(config);
  const serviceLayer = ProceduralMemoryServiceLive.pipe(Layer.provide(dbLayer));

  const run = <A, E>(
    effect: Effect.Effect<A, E, ProceduralMemoryService>,
  ) =>
    Effect.runPromise(
      Effect.scoped(effect.pipe(Effect.provide(serviceLayer))),
    );

  it("should store and retrieve a workflow", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ProceduralMemoryService;
        yield* svc.store(makeWorkflow("proc-1", "Deploy Pipeline"));
        return yield* svc.get("proc-1" as MemoryId);
      }),
    );

    expect(result.name).toBe("Deploy Pipeline");
    expect(result.successRate).toBe(0.8);
  });

  it("should list active workflows sorted by success rate", async () => {
    const entries = await run(
      Effect.gen(function* () {
        const svc = yield* ProceduralMemoryService;
        yield* svc.store({
          ...makeWorkflow("proc-1", "Low Success"),
          successRate: 0.3,
        });
        yield* svc.store({
          ...makeWorkflow("proc-2", "High Success"),
          successRate: 0.9,
        });
        return yield* svc.listActive("test-agent");
      }),
    );

    expect(entries.length).toBe(2);
    expect(entries[0]!.name).toBe("High Success");
  });

  it("should record outcome and update success rate", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ProceduralMemoryService;
        yield* svc.store({
          ...makeWorkflow("proc-1", "Test"),
          successRate: 0.5,
          useCount: 1,
        });
        yield* svc.recordOutcome("proc-1" as MemoryId, true);
        return yield* svc.get("proc-1" as MemoryId);
      }),
    );

    // EMA: 0.5 * 0.9 + 1 * 0.1 = 0.55
    expect(result.successRate).toBeCloseTo(0.55, 2);
    expect(result.useCount).toBe(2);
  });

  it("should find workflows by tags", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ProceduralMemoryService;
        yield* svc.store(makeWorkflow("proc-1", "Deploy", ["deploy", "ci"]));
        yield* svc.store(makeWorkflow("proc-2", "Test", ["test"]));
        yield* svc.store(
          makeWorkflow("proc-3", "Deploy & Test", ["deploy", "test"]),
        );
        return yield* svc.findByTags("test-agent", ["deploy"]);
      }),
    );

    expect(result.length).toBe(2);
  });
});
