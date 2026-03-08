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

  it("should return empty array for vector search when no embeddings exist", async () => {
    const results = await run(
      Effect.gen(function* () {
        const search = yield* MemorySearchService;
        return yield* search.searchVector([0.1, 0.2, 0.3], "test-agent", 5);
      }),
    );

    expect(results).toEqual([]);
  });

  it("should find entries by vector similarity (KNN)", async () => {
    const results = await run(
      Effect.gen(function* () {
        const db = yield* MemoryDatabase;
        const search = yield* MemorySearchService;
        const now = new Date().toISOString();

        // Store entries with embeddings — v1 is similar to query, v2 is dissimilar
        const embedding1 = Buffer.from(new Float32Array([0.9, 0.1, 0.0]).buffer);
        const embedding2 = Buffer.from(new Float32Array([0.0, 0.1, 0.9]).buffer);
        const embedding3 = Buffer.from(new Float32Array([0.85, 0.15, 0.05]).buffer);

        yield* db.exec(
          `INSERT INTO semantic_memory (id, agent_id, content, summary, importance, verified, tags, embedding, created_at, updated_at, access_count, last_accessed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`vec-1`, "test-agent", "Similar entry", "Similar", 0.8, 0, '["a"]', embedding1, now, now, 0, now],
        );
        yield* db.exec(
          `INSERT INTO semantic_memory (id, agent_id, content, summary, importance, verified, tags, embedding, created_at, updated_at, access_count, last_accessed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ["vec-2", "test-agent", "Dissimilar entry", "Dissimilar", 0.5, 0, '["b"]', embedding2, now, now, 0, now],
        );
        yield* db.exec(
          `INSERT INTO semantic_memory (id, agent_id, content, summary, importance, verified, tags, embedding, created_at, updated_at, access_count, last_accessed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ["vec-3", "test-agent", "Also similar entry", "Also similar", 0.7, 0, '["c"]', embedding3, now, now, 0, now],
        );

        // Query for entries similar to [1.0, 0.0, 0.0]
        return yield* search.searchVector([1.0, 0.0, 0.0], "test-agent", 2);
      }),
    );

    // Should return the 2 most similar entries (vec-1 and vec-3), ordered by similarity
    expect(results.length).toBe(2);
    expect(results[0]!.id).toBe("vec-1"); // Most similar to [1,0,0]
    expect(results[1]!.id).toBe("vec-3"); // Second most similar
  });

  it("should respect limit in vector search", async () => {
    const results = await run(
      Effect.gen(function* () {
        const db = yield* MemoryDatabase;
        const search = yield* MemorySearchService;
        const now = new Date().toISOString();

        for (let i = 0; i < 5; i++) {
          const emb = Buffer.from(new Float32Array([1.0 - i * 0.1, i * 0.1, 0]).buffer);
          yield* db.exec(
            `INSERT INTO semantic_memory (id, agent_id, content, summary, importance, verified, tags, embedding, created_at, updated_at, access_count, last_accessed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [`lim-${i}`, "test-agent", `Entry ${i}`, `E${i}`, 0.5, 0, '[]', emb, now, now, 0, now],
          );
        }

        return yield* search.searchVector([1.0, 0.0, 0.0], "test-agent", 3);
      }),
    );

    expect(results.length).toBe(3);
  });
});
