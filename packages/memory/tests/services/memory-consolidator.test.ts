import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  MemoryConsolidatorService,
  MemoryConsolidatorServiceLive,
} from "../../src/services/memory-consolidator.js";
import type { ConsolidatorConfig } from "../../src/services/memory-consolidator.js";
import { SemanticMemoryService, SemanticMemoryServiceLive } from "../../src/services/semantic-memory.js";
import { MemoryDatabaseLive } from "../../src/database.js";
import type { SemanticEntry, MemoryId } from "../../src/types.js";
import { defaultMemoryConfig } from "../../src/types.js";
import * as fs from "node:fs";

const TEST_DB = "/tmp/test-memory-consolidator-service.db";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeSemanticEntry = (
  id: string,
  content: string,
  importance: number = 0.5,
): SemanticEntry => ({
  id: id as MemoryId,
  agentId: "agent-test",
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

const config = { ...defaultMemoryConfig("agent-test"), dbPath: TEST_DB };
const dbLayer = MemoryDatabaseLive(config);
const semanticLayer = SemanticMemoryServiceLive.pipe(Layer.provide(dbLayer));

const makeConsolidatorLayer = (cfg?: ConsolidatorConfig) =>
  MemoryConsolidatorServiceLive(cfg).pipe(Layer.provide(dbLayer));

const run = <A, E>(
  effect: Effect.Effect<A, E, MemoryConsolidatorService | SemanticMemoryService>,
  cfg?: ConsolidatorConfig,
) => {
  const consolidatorLayer = makeConsolidatorLayer(cfg);
  const testLayer = Layer.mergeAll(consolidatorLayer, semanticLayer);
  return Effect.runPromise(
    Effect.scoped(effect.pipe(Effect.provide(testLayer))),
  );
};

describe("MemoryConsolidatorService", () => {
  afterEach(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(TEST_DB + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  // ─── consolidate ───────────────────────────────────────────────────────────

  it("consolidate returns result with replayed, compressed, pruned counts", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* MemoryConsolidatorService;
        return yield* svc.consolidate("agent-test");
      }),
    );

    // With an empty DB there's nothing to compress or prune
    expect(typeof result.replayed).toBe("number");
    expect(typeof result.connected).toBe("number");
    expect(typeof result.compressed).toBe("number");
    expect(typeof result.pruned).toBe("number");
    expect(result.replayed).toBe(0);
    expect(result.connected).toBe(0);
    expect(result.compressed).toBe(0);
    expect(result.pruned).toBe(0);
  });

  // ─── COMPRESS: decay ──────────────────────────────────────────────────────

  it("compress decays semantic entry importance by decayFactor", async () => {
    const decayFactor = 0.9;

    await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const svc = yield* MemoryConsolidatorService;

        // Store an entry with importance above the prune threshold
        yield* semantic.store(makeSemanticEntry("e1", "important memory fact", 0.8));

        // Run consolidation cycle
        yield* svc.consolidate("agent-test");

        // The entry should have been decayed: 0.8 * 0.9 = 0.72
        const entries = yield* semantic.listByAgent("agent-test", 10);
        const entry = entries.find((e) => e.id === "e1");
        expect(entry).toBeDefined();
        // Allow small floating-point tolerance
        expect(entry!.importance).toBeCloseTo(0.8 * decayFactor, 5);
      }),
      { decayFactor, pruneThreshold: 0.1 },
    );
  });

  // ─── COMPRESS: prune ──────────────────────────────────────────────────────

  it("compress prunes entries below threshold", async () => {
    // Set decay factor so that a 0.15 entry drops below 0.1 after one cycle:
    // 0.15 * 0.6 = 0.09 < 0.1
    const decayFactor = 0.6;
    const pruneThreshold = 0.1;

    await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const svc = yield* MemoryConsolidatorService;

        // Entry just above prune threshold — will drop below after one decay
        yield* semantic.store(makeSemanticEntry("low-e1", "low importance memory fact", 0.15));
        // Entry well above prune threshold — should survive
        yield* semantic.store(makeSemanticEntry("high-e1", "high importance memory knowledge", 0.8));

        const result = yield* svc.consolidate("agent-test");

        // The low-importance entry should have been pruned
        expect(result.pruned).toBe(1);

        const entries = yield* semantic.listByAgent("agent-test", 10);
        const lowEntry = entries.find((e) => e.id === "low-e1");
        const highEntry = entries.find((e) => e.id === "high-e1");

        expect(lowEntry).toBeUndefined();
        expect(highEntry).toBeDefined();
      }),
      { decayFactor, pruneThreshold },
    );
  });

  // ─── notifyEntry ──────────────────────────────────────────────────────────

  it("notifyEntry returns false before threshold is reached", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* MemoryConsolidatorService;

        const r1 = yield* svc.notifyEntry();
        const r2 = yield* svc.notifyEntry();
        const r3 = yield* svc.notifyEntry();

        return { r1, r2, r3 };
      }),
      { threshold: 5 },
    );

    expect(result.r1).toBe(false);
    expect(result.r2).toBe(false);
    expect(result.r3).toBe(false);
  });

  it("notifyEntry increments counter and returns true at threshold", async () => {
    const threshold = 3;

    const results = await run(
      Effect.gen(function* () {
        const svc = yield* MemoryConsolidatorService;

        const r1 = yield* svc.notifyEntry(); // 1 — false
        const r2 = yield* svc.notifyEntry(); // 2 — false
        const r3 = yield* svc.notifyEntry(); // 3 — true (reached threshold)

        return [r1, r2, r3];
      }),
      { threshold },
    );

    expect(results[0]).toBe(false);
    expect(results[1]).toBe(false);
    expect(results[2]).toBe(true);
  });

  // ─── pendingCount ─────────────────────────────────────────────────────────

  it("pendingCount returns 0 initially", async () => {
    const count = await run(
      Effect.gen(function* () {
        const svc = yield* MemoryConsolidatorService;
        return yield* svc.pendingCount();
      }),
    );

    expect(count).toBe(0);
  });

  it("pendingCount reflects notifyEntry calls", async () => {
    const count = await run(
      Effect.gen(function* () {
        const svc = yield* MemoryConsolidatorService;

        yield* svc.notifyEntry();
        yield* svc.notifyEntry();
        yield* svc.notifyEntry();

        return yield* svc.pendingCount();
      }),
      { threshold: 100 },
    );

    expect(count).toBe(3);
  });

  it("consolidate resets pending count to zero", async () => {
    const count = await run(
      Effect.gen(function* () {
        const svc = yield* MemoryConsolidatorService;

        yield* svc.notifyEntry();
        yield* svc.notifyEntry();

        // Before consolidation
        const before = yield* svc.pendingCount();
        expect(before).toBe(2);

        yield* svc.consolidate("agent-test");

        // After consolidation
        return yield* svc.pendingCount();
      }),
      { threshold: 100 },
    );

    expect(count).toBe(0);
  });
});
