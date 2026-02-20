import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  MemorySearchService,
  MemorySearchServiceLive,
  MemoryDatabaseLive,
  MemoryDatabase,
} from "../src/index.js";
import type { MemoryId } from "../src/types.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-search-db";
const TEST_DB = path.join(TEST_DB_DIR, "search.db");

describe("MemorySearchService", () => {
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
  const serviceLayer = MemorySearchServiceLive.pipe(Layer.provide(dbLayer));
  const fullLayer = Layer.mergeAll(serviceLayer, dbLayer);

  const run = <A, E>(
    effect: Effect.Effect<A, E, MemorySearchService | MemoryDatabase>,
  ) =>
    Effect.runPromise(
      Effect.scoped(effect.pipe(Effect.provide(fullLayer))),
    );

  it("should search semantic memory via FTS5", async () => {
    const results = await run(
      Effect.gen(function* () {
        const db = yield* MemoryDatabase;
        const search = yield* MemorySearchService;
        const now = new Date().toISOString();

        // Insert test data
        yield* db.exec(
          `INSERT INTO semantic_memory (id, agent_id, content, summary, importance, verified, tags, created_at, updated_at, access_count, last_accessed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            "sem-1",
            "test-agent",
            "TypeScript provides static type checking for JavaScript applications",
            "TypeScript type checking",
            0.8,
            0,
            '["typescript", "types"]',
            now,
            now,
            0,
            now,
          ],
        );

        yield* db.exec(
          `INSERT INTO semantic_memory (id, agent_id, content, summary, importance, verified, tags, created_at, updated_at, access_count, last_accessed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            "sem-2",
            "test-agent",
            "Python is a dynamically typed programming language",
            "Python dynamic typing",
            0.6,
            0,
            '["python"]',
            now,
            now,
            0,
            now,
          ],
        );

        return yield* search.searchSemantic({
          query: "TypeScript",
          agentId: "test-agent",
          limit: 10,
        });
      }),
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.content).toContain("TypeScript");
  });

  it("should search episodic log via FTS5", async () => {
    const results = await run(
      Effect.gen(function* () {
        const db = yield* MemoryDatabase;
        const search = yield* MemorySearchService;
        const now = new Date().toISOString();
        const today = now.slice(0, 10);

        yield* db.exec(
          `INSERT INTO episodic_log (id, agent_id, date, content, event_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            "ep-1",
            "test-agent",
            today,
            "Successfully deployed the application to production",
            "task-completed",
            now,
          ],
        );

        yield* db.exec(
          `INSERT INTO episodic_log (id, agent_id, date, content, event_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            "ep-2",
            "test-agent",
            today,
            "Running unit tests for the core module",
            "task-started",
            now,
          ],
        );

        return yield* search.searchEpisodic({
          query: "deployed production",
          agentId: "test-agent",
          limit: 10,
        });
      }),
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.content).toContain("deployed");
  });

  it("should fail for vector search in Tier 1", async () => {
    const result = await run(
      Effect.gen(function* () {
        const search = yield* MemorySearchService;
        return yield* search
          .searchVector([0.1, 0.2, 0.3], "test-agent", 5)
          .pipe(Effect.either);
      }),
    );

    expect(result._tag).toBe("Left");
  });
});
