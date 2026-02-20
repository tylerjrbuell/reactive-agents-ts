import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  SemanticMemoryService,
  SemanticMemoryServiceLive,
  MemoryDatabaseLive,
} from "../src/index.js";
import type { SemanticEntry, MemoryId } from "../src/types.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-semantic-db";
const TEST_DB = path.join(TEST_DB_DIR, "semantic.db");

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

describe("SemanticMemoryService", () => {
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
  const serviceLayer = SemanticMemoryServiceLive.pipe(Layer.provide(dbLayer));

  const run = <A, E>(
    effect: Effect.Effect<A, E, SemanticMemoryService>,
  ) =>
    Effect.runPromise(
      Effect.scoped(effect.pipe(Effect.provide(serviceLayer))),
    );

  it("should store and retrieve a semantic entry", async () => {
    const entry = makeEntry("sem-1", "TypeScript is a typed superset of JavaScript");

    const result = await run(
      Effect.gen(function* () {
        const svc = yield* SemanticMemoryService;
        yield* svc.store(entry);
        return yield* svc.get("sem-1" as MemoryId);
      }),
    );

    expect(result.id).toBe("sem-1" as MemoryId);
    expect(result.content).toBe("TypeScript is a typed superset of JavaScript");
    expect(result.tags).toEqual(["test"]);
  });

  it("should list entries by agent sorted by importance", async () => {
    const entries = await run(
      Effect.gen(function* () {
        const svc = yield* SemanticMemoryService;
        yield* svc.store(makeEntry("sem-1", "Low importance fact", 0.3));
        yield* svc.store(makeEntry("sem-2", "High importance fact", 0.9));
        yield* svc.store(makeEntry("sem-3", "Medium importance fact", 0.6));
        return yield* svc.listByAgent("test-agent");
      }),
    );

    expect(entries.length).toBe(3);
    expect(entries[0]!.importance).toBe(0.9);
    expect(entries[2]!.importance).toBe(0.3);
  });

  it("should update an entry", async () => {
    const updated = await run(
      Effect.gen(function* () {
        const svc = yield* SemanticMemoryService;
        yield* svc.store(makeEntry("sem-1", "Original content"));
        yield* svc.update("sem-1" as MemoryId, {
          content: "Updated content",
          importance: 0.9,
        });
        return yield* svc.get("sem-1" as MemoryId);
      }),
    );

    expect(updated.content).toBe("Updated content");
    expect(updated.importance).toBe(0.9);
  });

  it("should delete an entry", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* SemanticMemoryService;
        yield* svc.store(makeEntry("sem-1", "To be deleted"));
        yield* svc.delete("sem-1" as MemoryId);
        return yield* svc.listByAgent("test-agent");
      }),
    );

    expect(result.length).toBe(0);
  });

  it("should record access and update count", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* SemanticMemoryService;
        yield* svc.store(makeEntry("sem-1", "Accessed entry"));
        yield* svc.recordAccess("sem-1" as MemoryId);
        yield* svc.recordAccess("sem-1" as MemoryId);
        return yield* svc.get("sem-1" as MemoryId);
      }),
    );

    expect(result.accessCount).toBe(2);
  });

  it("should generate markdown projection", async () => {
    const md = await run(
      Effect.gen(function* () {
        const svc = yield* SemanticMemoryService;
        yield* svc.store(makeEntry("sem-1", "Important knowledge about effects", 0.9));
        yield* svc.store(makeEntry("sem-2", "Less important detail", 0.3));
        return yield* svc.generateMarkdown("test-agent");
      }),
    );

    expect(md).toContain("# Agent Memory");
    expect(md).toContain("test-agent");
  });
});
