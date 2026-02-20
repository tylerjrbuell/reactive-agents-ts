import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import {
  MemoryService,
  createMemoryLayer,
} from "../src/index.js";
import type { SemanticEntry, DailyLogEntry, WorkingMemoryItem, MemoryId, SessionSnapshot } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-memory-svc-db";
const TEST_DB = path.join(TEST_DB_DIR, "memory-svc.db");

describe("MemoryService", () => {
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
    try {
      fs.rmSync(".reactive-agents", { recursive: true });
    } catch {
      /* ignore */
    }
  });

  const layer = createMemoryLayer("1", {
    agentId: "test-agent",
    dbPath: TEST_DB,
  });

  const run = <A, E>(effect: Effect.Effect<A, E, MemoryService>) =>
    Effect.runPromise(
      Effect.scoped(effect.pipe(Effect.provide(layer))),
    );

  it("should bootstrap and return MemoryBootstrapResult", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* MemoryService;
        return yield* svc.bootstrap("test-agent");
      }),
    );

    expect(result.agentId).toBe("test-agent");
    expect(result.tier).toBe("1");
    expect(result.recentEpisodes).toEqual([]);
    expect(result.activeWorkflows).toEqual([]);
    expect(result.workingMemory).toEqual([]);
    expect(result.bootstrappedAt).toBeInstanceOf(Date);
  });

  it("should add to working memory", async () => {
    const items = await run(
      Effect.gen(function* () {
        const svc = yield* MemoryService;
        const item: WorkingMemoryItem = {
          id: "wm-1" as MemoryId,
          content: "Remember this",
          importance: 0.7,
          addedAt: new Date(),
          source: { type: "system", id: "test" },
        };
        yield* svc.addToWorking(item);
        return yield* svc.getWorking();
      }),
    );

    expect(items.length).toBe(1);
    expect(items[0]!.content).toBe("Remember this");
  });

  it("should store semantic entry and retrieve it", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* MemoryService;
        const entry: SemanticEntry = {
          id: "sem-1" as MemoryId,
          agentId: "test-agent",
          content: "Effect-TS uses algebraic effects for type-safe composition",
          summary: "Effect-TS algebraic effects",
          importance: 0.8,
          verified: false,
          tags: ["effect-ts"],
          createdAt: new Date(),
          updatedAt: new Date(),
          accessCount: 0,
          lastAccessedAt: new Date(),
        };
        return yield* svc.storeSemantic(entry);
      }),
    );

    expect(result).toBe("sem-1" as MemoryId);
  });

  it("should log episodic event", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* MemoryService;
        const entry: DailyLogEntry = {
          id: "ep-1" as MemoryId,
          agentId: "test-agent",
          date: new Date().toISOString().slice(0, 10),
          content: "Started building memory package",
          eventType: "task-started",
          createdAt: new Date(),
        };
        return yield* svc.logEpisode(entry);
      }),
    );

    expect(result).toBe("ep-1" as MemoryId);
  });

  it("should save session snapshot", async () => {
    await run(
      Effect.gen(function* () {
        const svc = yield* MemoryService;
        const snapshot: SessionSnapshot = {
          id: "session-1",
          agentId: "test-agent",
          messages: [{ role: "user", content: "test" }],
          summary: "Test session",
          keyDecisions: [],
          taskIds: [],
          startedAt: new Date(),
          endedAt: new Date(),
          totalCost: 0,
          totalTokens: 0,
        };
        yield* svc.snapshot(snapshot);
      }),
    );
    // If we get here without error, the test passes
    expect(true).toBe(true);
  });

  it("should flush memory to markdown", async () => {
    await run(
      Effect.gen(function* () {
        const svc = yield* MemoryService;
        // Store something first
        const entry: SemanticEntry = {
          id: "sem-flush" as MemoryId,
          agentId: "test-agent",
          content: "Important fact to persist",
          summary: "Important fact",
          importance: 0.9,
          verified: true,
          tags: ["test"],
          createdAt: new Date(),
          updatedAt: new Date(),
          accessCount: 0,
          lastAccessedAt: new Date(),
        };
        yield* svc.storeSemantic(entry);
        yield* svc.flush("test-agent");
      }),
    );

    // Check that the markdown file was created
    const mdPath = path.join(
      ".reactive-agents",
      "memory",
      "test-agent",
      "memory.md",
    );
    const exists = fs.existsSync(mdPath);
    expect(exists).toBe(true);

    if (exists) {
      const content = fs.readFileSync(mdPath, "utf8");
      expect(content).toContain("Agent Memory");
    }
  });
});
