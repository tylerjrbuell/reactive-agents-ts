import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  CompactionService,
  CompactionServiceLive,
  SemanticMemoryService,
  SemanticMemoryServiceLive,
  MemoryDatabase,
  MemoryDatabaseLive,
  createMemoryLayer,
} from "../src/index.js";
import type { SemanticEntry, MemoryId } from "../src/types.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-compaction-db";
const TEST_DB = path.join(TEST_DB_DIR, "compaction.db");

const makeEntry = (
  id: string,
  content: string,
  importance = 0.5,
): SemanticEntry => ({
  id: id as MemoryId,
  agentId: "test-agent",
  content,
  summary: content.slice(0, 50),
  importance,
  verified: false,
  tags: ["test"],
  createdAt: new Date(),
  updatedAt: new Date(),
  accessCount: 0,
  lastAccessedAt: new Date(),
});

describe("CompactionService", () => {
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

  const servicesLayer = Layer.mergeAll(
    CompactionServiceLive,
    SemanticMemoryServiceLive,
  ).pipe(Layer.provide(dbLayer));

  const testLayer = Layer.mergeAll(dbLayer, servicesLayer);

  it("is available from createMemoryLayer", async () => {
    const memoryLayer = createMemoryLayer("1", {
      agentId: "test-agent",
      dbPath: TEST_DB,
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CompactionService;
        return typeof svc.compact === "function";
      }).pipe(Effect.provide(memoryLayer)),
    );

    expect(result).toBe(true);
  });

  it("compactByCount removes lowest-importance entries above threshold", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const compaction = yield* CompactionService;
        const db = yield* MemoryDatabase;

        // Store 5 entries with varying importance
        yield* semantic.store(makeEntry("e1", "entry one", 0.1));
        yield* semantic.store(makeEntry("e2", "entry two", 0.2));
        yield* semantic.store(makeEntry("e3", "entry three", 0.8));
        yield* semantic.store(makeEntry("e4", "entry four", 0.9));
        yield* semantic.store(makeEntry("e5", "entry five", 0.3));

        // Compact to max 3 entries — should remove 2 lowest importance
        const removed = yield* compaction.compactByCount("test-agent", 3);

        // removed > 0 (exact count includes FTS trigger changes)
        expect(removed).toBeGreaterThan(0);

        // Verify 3 entries remain
        const rows = yield* db.query<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM semantic_memory WHERE agent_id = ?`,
          ["test-agent"],
        );
        expect(rows[0]!.cnt).toBe(3);

        // Verify the remaining are the highest importance ones
        const remaining = yield* semantic.listByAgent("test-agent", 10);
        const importances = remaining.map((e) => e.importance).sort();
        expect(importances).toEqual([0.3, 0.8, 0.9]);
      }).pipe(Effect.provide(testLayer)),
    );
  });

  it("compactByCount returns 0 when under threshold", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const compaction = yield* CompactionService;

        yield* semantic.store(makeEntry("e1", "entry one", 0.5));
        yield* semantic.store(makeEntry("e2", "entry two", 0.6));

        const removed = yield* compaction.compactByCount("test-agent", 5);
        return removed;
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result).toBe(0);
  });

  it("compact dispatches to count strategy", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const compaction = yield* CompactionService;
        const db = yield* MemoryDatabase;

        yield* semantic.store(makeEntry("e1", "entry one", 0.1));
        yield* semantic.store(makeEntry("e2", "entry two", 0.9));
        yield* semantic.store(makeEntry("e3", "entry three", 0.5));

        const removed = yield* compaction.compact("test-agent", {
          strategy: "count",
          maxEntries: 2,
        });

        expect(removed).toBeGreaterThan(0);

        // Verify only 2 remain
        const rows = yield* db.query<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM semantic_memory WHERE agent_id = ?`,
          ["test-agent"],
        );
        expect(rows[0]!.cnt).toBe(2);
      }).pipe(Effect.provide(testLayer)),
    );
  });

  it("compactBySimilarity removes duplicate content entries", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const compaction = yield* CompactionService;
        const db = yield* MemoryDatabase;

        // Store entries with duplicate content
        yield* semantic.store(makeEntry("e1", "duplicate content", 0.5));
        yield* semantic.store(makeEntry("e2", "duplicate content", 0.8));
        yield* semantic.store(makeEntry("e3", "unique content", 0.6));

        const removed = yield* compaction.compactBySimilarity(
          "test-agent",
          0.9,
        );

        // Should remove at least 1 duplicate
        expect(removed).toBeGreaterThan(0);

        const rows = yield* db.query<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM semantic_memory WHERE agent_id = ?`,
          ["test-agent"],
        );
        expect(rows[0]!.cnt).toBe(2);
      }).pipe(Effect.provide(testLayer)),
    );
  });
});
