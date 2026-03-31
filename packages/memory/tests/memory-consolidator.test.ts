import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  MemoryConsolidator,
  MemoryConsolidatorLive,
  SemanticMemoryService,
  SemanticMemoryServiceLive,
  MemoryDatabaseLive,
  MemoryDatabase,
} from "../src/index.js";
import type { SemanticEntry, MemoryId } from "../src/types.js";
import { defaultMemoryConfig } from "../src/types.js";
import { createMemoryLayer } from "../src/runtime.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-consolidator-db";
const TEST_DB = path.join(TEST_DB_DIR, "consolidator.db");

const makeEntry = (
  id: string,
  content: string,
  opts: {
    importance?: number;
    accessCount?: number;
    lastAccessedAt?: Date;
  } = {},
): SemanticEntry => ({
  id: id as MemoryId,
  agentId: "test-agent",
  content,
  summary: content.slice(0, 50),
  importance: opts.importance ?? 0.5,
  verified: false,
  tags: ["test"],
  createdAt: new Date(),
  updatedAt: new Date(),
  accessCount: opts.accessCount ?? 0,
  lastAccessedAt: opts.lastAccessedAt ?? new Date(),
});

describe("MemoryConsolidator", () => {
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
  const consolidatorLayer = MemoryConsolidatorLive(config).pipe(
    Layer.provide(dbLayer),
  );
  const semanticLayer = SemanticMemoryServiceLive.pipe(Layer.provide(dbLayer));
  const testLayer = Layer.mergeAll(consolidatorLayer, semanticLayer);

  const run = <A, E>(
    effect: Effect.Effect<A, E, MemoryConsolidator | SemanticMemoryService>,
  ) =>
    Effect.runPromise(
      Effect.scoped(effect.pipe(Effect.provide(testLayer))),
    );

  it("is available in createMemoryLayer()", async () => {
    const memLayer = createMemoryLayer("1", {
      agentId: "test-agent",
      dbPath: TEST_DB,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        MemoryConsolidator.pipe(
          Effect.flatMap((svc) => svc.decayUnused("test-agent", 0.01)),
          Effect.provide(memLayer),
        ),
      ),
    );

    // Should return 0 (no entries to decay), proving the service is resolved
    expect(result).toBe(0);
  });

  it("decayUnused reduces importance of old entries", async () => {
    const oldDate = new Date(Date.now() - 14 * 86_400_000); // 14 days ago

    const result = await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const consolidator = yield* MemoryConsolidator;

        // Store an entry with old access date and moderate importance
        yield* semantic.store(
          makeEntry("old-entry", "This is an old memory that should decay", {
            importance: 0.8,
            accessCount: 1,
            lastAccessedAt: oldDate,
          }),
        );

        // Run decay
        const affected = yield* consolidator.decayUnused("test-agent", 0.1);

        // Verify the entry was decayed
        expect(affected).toBeGreaterThanOrEqual(1);

        // Read back and check importance decreased
        const entries = yield* semantic.listByAgent("test-agent", 10);
        const entry = entries.find((e) => e.id === "old-entry");
        expect(entry).toBeDefined();
        expect(entry!.importance).toBeLessThan(0.8);
      }),
    );
  });

  it("decayUnused does not affect recently accessed entries", async () => {
    const result = await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const consolidator = yield* MemoryConsolidator;

        // Store a recently accessed entry
        yield* semantic.store(
          makeEntry("recent-entry", "This is a recently accessed memory entry", {
            importance: 0.8,
            accessCount: 3,
            lastAccessedAt: new Date(), // just now
          }),
        );

        // Run decay
        const affected = yield* consolidator.decayUnused("test-agent", 0.1);

        // Recent entry should not be decayed
        expect(affected).toBe(0);
      }),
    );
  });

  it("promoteActive boosts importance of frequently accessed entries", async () => {
    const result = await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const consolidator = yield* MemoryConsolidator;

        // Store an entry with high access count but moderate importance
        yield* semantic.store(
          makeEntry("active-entry", "This is a frequently accessed memory entry", {
            importance: 0.5,
            accessCount: 10,
          }),
        );

        // Promote active entries
        const affected = yield* consolidator.promoteActive("test-agent");

        // Should have promoted the active entry
        expect(affected).toBeGreaterThanOrEqual(1);

        // Read back and check importance increased
        const entries = yield* semantic.listByAgent("test-agent", 10);
        const entry = entries.find((e) => e.id === "active-entry");
        expect(entry).toBeDefined();
        expect(entry!.importance).toBeGreaterThan(0.5);
      }),
    );
  });

  it("promoteActive does not promote entries already at max importance", async () => {
    const result = await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const consolidator = yield* MemoryConsolidator;

        // Store an entry already at near-max importance
        yield* semantic.store(
          makeEntry("max-entry", "This entry is already at maximum importance level", {
            importance: 0.96,
            accessCount: 10,
          }),
        );

        // Promote active entries — should skip since importance >= 0.95
        const affected = yield* consolidator.promoteActive("test-agent");
        expect(affected).toBe(0);
      }),
    );
  });

  it("consolidate() decays near-duplicate entries sharing the same content prefix", async () => {
    // Two entries whose first 40 characters match — classic repeated extraction
    const base = "The team agreed on PostgreSQL as the primary database for all new services";
    const dup = base.slice(0, 40) + " and will migrate existing ones by Q3.";

    await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const consolidator = yield* MemoryConsolidator;

        // Original: older, higher importance
        yield* semantic.store({
          ...makeEntry("orig-dedup", base, { importance: 0.8 }),
          createdAt: new Date(Date.now() - 3_600_000),
          updatedAt: new Date(Date.now() - 3_600_000),
        } as any);

        // Near-duplicate: newer, lower importance — should be decayed
        yield* semantic.store(makeEntry("dup-dedup", dup, { importance: 0.6 }));

        const affected = yield* consolidator.consolidate("test-agent");
        expect(affected).toBeGreaterThanOrEqual(1);

        const entries = yield* semantic.listByAgent("test-agent", 10);
        const orig = entries.find((e) => e.id === "orig-dedup");
        const dupEntry = entries.find((e) => e.id === "dup-dedup");

        expect(orig).toBeDefined();
        expect(orig!.importance).toBe(0.8); // original untouched

        expect(dupEntry).toBeDefined();
        expect(dupEntry!.importance).toBeLessThan(0.6); // duplicate decayed
      }),
    );
  });

  it("consolidate() does not decay entries with different content prefixes", async () => {
    await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const consolidator = yield* MemoryConsolidator;

        yield* semantic.store(makeEntry("entry-a", "Redis is used for caching all session data in production", { importance: 0.7 }));
        yield* semantic.store(makeEntry("entry-b", "PostgreSQL handles all persistent relational data in the system", { importance: 0.7 }));

        yield* consolidator.consolidate("test-agent");

        const entries = yield* semantic.listByAgent("test-agent", 10);
        const a = entries.find((e) => e.id === "entry-a");
        const b = entries.find((e) => e.id === "entry-b");

        // Neither should have been decayed by the dedup step (different prefixes)
        // They may be decayed by the normal decay step only if old — but these are fresh
        expect(a?.importance).toBeGreaterThanOrEqual(0.6);
        expect(b?.importance).toBeGreaterThanOrEqual(0.6);
      }),
    );
  });

  it("consolidate runs full cycle (decay + promote + cleanup)", async () => {
    const oldDate = new Date(Date.now() - 14 * 86_400_000);

    const result = await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const consolidator = yield* MemoryConsolidator;

        // Mix of entries: old low-importance (should be cleaned), active (should be promoted)
        yield* semantic.store(
          makeEntry("stale-entry", "This old entry has very low importance value", {
            importance: 0.03,
            accessCount: 1,
            lastAccessedAt: oldDate,
          }),
        );
        yield* semantic.store(
          makeEntry("active-entry-2", "This is an actively used memory entry in system", {
            importance: 0.5,
            accessCount: 8,
          }),
        );

        const affected = yield* consolidator.consolidate("test-agent");

        // At least the stale entry should have been cleaned up
        // and the active entry should have been promoted
        expect(affected).toBeGreaterThanOrEqual(1);
      }),
    );
  });
});
