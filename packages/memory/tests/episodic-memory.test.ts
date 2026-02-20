import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  EpisodicMemoryService,
  EpisodicMemoryServiceLive,
  MemoryDatabaseLive,
} from "../src/index.js";
import type { DailyLogEntry, SessionSnapshot, MemoryId } from "../src/types.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-episodic-db";
const TEST_DB = path.join(TEST_DB_DIR, "episodic.db");

const makeLogEntry = (id: string, content: string): DailyLogEntry => ({
  id: id as MemoryId,
  agentId: "test-agent",
  date: new Date().toISOString().slice(0, 10),
  content,
  eventType: "observation",
  createdAt: new Date(),
});

describe("EpisodicMemoryService", () => {
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
  const serviceLayer = EpisodicMemoryServiceLive.pipe(Layer.provide(dbLayer));

  const run = <A, E>(
    effect: Effect.Effect<A, E, EpisodicMemoryService>,
  ) =>
    Effect.runPromise(
      Effect.scoped(effect.pipe(Effect.provide(serviceLayer))),
    );

  it("should log and retrieve entries", async () => {
    const entries = await run(
      Effect.gen(function* () {
        const svc = yield* EpisodicMemoryService;
        yield* svc.log(makeLogEntry("ep-1", "Task started"));
        yield* svc.log(makeLogEntry("ep-2", "Task completed"));
        return yield* svc.getRecent("test-agent", 10);
      }),
    );

    expect(entries.length).toBe(2);
  });

  it("should get entries by task", async () => {
    const entries = await run(
      Effect.gen(function* () {
        const svc = yield* EpisodicMemoryService;
        const entry: DailyLogEntry = {
          ...makeLogEntry("ep-1", "Task work"),
          taskId: "task-123",
        };
        yield* svc.log(entry);
        return yield* svc.getByTask("task-123");
      }),
    );

    expect(entries.length).toBe(1);
    expect(entries[0]!.taskId).toBe("task-123");
  });

  it("should save and retrieve session snapshot", async () => {
    const snapshot: SessionSnapshot = {
      id: "session-1",
      agentId: "test-agent",
      messages: [{ role: "user", content: "hello" }],
      summary: "Test session",
      keyDecisions: ["decided to test"],
      taskIds: ["task-1"],
      startedAt: new Date(),
      endedAt: new Date(),
      totalCost: 0.05,
      totalTokens: 100,
    };

    const result = await run(
      Effect.gen(function* () {
        const svc = yield* EpisodicMemoryService;
        yield* svc.saveSnapshot(snapshot);
        return yield* svc.getLatestSnapshot("test-agent");
      }),
    );

    expect(result).not.toBeNull();
    expect(result!.id).toBe("session-1");
    expect(result!.summary).toBe("Test session");
    expect(result!.totalTokens).toBe(100);
  });

  it("should return null when no snapshot exists", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* EpisodicMemoryService;
        return yield* svc.getLatestSnapshot("nonexistent-agent");
      }),
    );

    expect(result).toBeNull();
  });

  it("should prune old entries", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* EpisodicMemoryService;
        // Log an entry with an old date
        const oldEntry: DailyLogEntry = {
          id: "ep-old" as MemoryId,
          agentId: "test-agent",
          date: "2020-01-01",
          content: "Old entry",
          eventType: "observation",
          createdAt: new Date("2020-01-01"),
        };
        yield* svc.log(oldEntry);
        yield* svc.log(makeLogEntry("ep-new", "New entry"));

        const pruned = yield* svc.prune("test-agent", 30);
        const remaining = yield* svc.getRecent("test-agent", 100);
        return { pruned, remaining };
      }),
    );

    // bun:sqlite .changes includes FTS5 trigger-fired changes, so count may be > 1
    expect(result.pruned).toBeGreaterThanOrEqual(1);
    expect(result.remaining.length).toBe(1);
  });
});
