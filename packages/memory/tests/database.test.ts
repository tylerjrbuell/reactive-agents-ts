import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import { MemoryDatabase, MemoryDatabaseLive } from "../src/index.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-memory-db";
const TEST_DB = path.join(TEST_DB_DIR, "test-memory.db");

describe("MemoryDatabase", () => {
  afterEach(() => {
    try {
      // Clean up WAL and SHM files too
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

  it("should create schema and run queries", async () => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const layer = MemoryDatabaseLive(config);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* MemoryDatabase;
          const rows = yield* db.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table'",
          );
          return rows.map((r) => r.name);
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(result).toContain("semantic_memory");
    expect(result).toContain("episodic_log");
    expect(result).toContain("session_snapshots");
    expect(result).toContain("procedural_memory");
    expect(result).toContain("zettel_links");
  });

  it("should insert and query data", async () => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const layer = MemoryDatabaseLive(config);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* MemoryDatabase;
          const now = new Date().toISOString();

          yield* db.exec(
            `INSERT INTO semantic_memory (id, agent_id, content, summary, importance, verified, tags, created_at, updated_at, access_count, last_accessed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              "test-1",
              "test-agent",
              "test content",
              "test summary",
              0.8,
              0,
              "[]",
              now,
              now,
              0,
              now,
            ],
          );

          const rows = yield* db.query<{ id: string; content: string }>(
            "SELECT id, content FROM semantic_memory WHERE agent_id = ?",
            ["test-agent"],
          );
          return rows;
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe("test-1");
    expect(result[0]!.content).toBe("test content");
  });

  it("should support exec with changes count", async () => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const layer = MemoryDatabaseLive(config);

    const changes = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* MemoryDatabase;
          const now = new Date().toISOString();

          yield* db.exec(
            `INSERT INTO semantic_memory (id, agent_id, content, summary, importance, verified, tags, created_at, updated_at, access_count, last_accessed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              "test-1",
              "test-agent",
              "content",
              "summary",
              0.5,
              0,
              "[]",
              now,
              now,
              0,
              now,
            ],
          );

          return yield* db.exec(
            "DELETE FROM semantic_memory WHERE id = ?",
            ["test-1"],
          );
        }).pipe(Effect.provide(layer)),
      ),
    );

    // bun:sqlite .changes includes trigger-fired changes (FTS5 sync triggers),
    // so the count may be > 1. We just check that at least 1 change was made.
    expect(changes).toBeGreaterThanOrEqual(1);
  });
});
