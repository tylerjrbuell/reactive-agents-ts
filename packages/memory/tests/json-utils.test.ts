import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { safeJsonParse } from "../src/json-utils.js";
import {
  EpisodicMemoryService,
  EpisodicMemoryServiceLive,
  MemoryDatabaseLive,
} from "../src/index.js";
import type { MemoryId, DailyLogEntry } from "../src/types.js";
import { defaultMemoryConfig } from "../src/types.js";
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('["a","b"]', [])).toEqual(["a", "b"]);
    expect(safeJsonParse('{"x":1}', {})).toEqual({ x: 1 });
  });

  it("returns fallback for null/undefined/empty", () => {
    expect(safeJsonParse(null, ["default"])).toEqual(["default"]);
    expect(safeJsonParse(undefined, ["default"])).toEqual(["default"]);
    expect(safeJsonParse("", ["default"])).toEqual(["default"]);
  });

  it("returns fallback for malformed JSON", () => {
    expect(safeJsonParse("{broken", {})).toEqual({});
    expect(safeJsonParse("not json at all", [])).toEqual([]);
    expect(safeJsonParse("{'single': 'quotes'}", {})).toEqual({});
  });

  it("returns fallback for truncated JSON", () => {
    expect(safeJsonParse('["a","b"', [])).toEqual([]);
    expect(safeJsonParse('{"key": "val', {})).toEqual({});
  });
});

describe("corrupt SQLite row resilience", () => {
  const TEST_DB_DIR = "/tmp/test-json-utils-db";
  const TEST_DB = path.join(TEST_DB_DIR, "corrupt.db");

  afterEach(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true }); } catch { /* ignore */ }
  });

  it("episodic-memory survives corrupt metadata in a row", async () => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const dbLayer = MemoryDatabaseLive(config);
    const serviceLayer = EpisodicMemoryServiceLive.pipe(Layer.provide(dbLayer));

    const run = <A, E>(effect: Effect.Effect<A, E, EpisodicMemoryService>) =>
      Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(serviceLayer))));

    const today = new Date().toISOString().slice(0, 10);

    await run(
      Effect.gen(function* () {
        const svc = yield* EpisodicMemoryService;
        yield* svc.log({
          id: "good-1" as MemoryId,
          agentId: "test-agent",
          date: today,
          content: "good entry",
          eventType: "observation",
          metadata: { valid: true },
          createdAt: new Date(),
        } as DailyLogEntry);
      }),
    );

    const db = new Database(TEST_DB);
    db.run(
      `INSERT INTO episodic_log (id, agent_id, date, content, event_type, metadata, created_at)
       VALUES ('corrupt-1', 'test-agent', ?, 'corrupt row', 'observation',
               '{broken json', datetime('now'))`,
      [today],
    );
    db.close();

    const entries = await run(
      Effect.gen(function* () {
        const svc = yield* EpisodicMemoryService;
        return yield* svc.getToday("test-agent");
      }),
    );

    expect(entries.length).toBe(2);
    const corrupt = entries.find((e) => e.id === "corrupt-1");
    expect(corrupt).toBeDefined();
    expect(corrupt!.content).toBe("corrupt row");
    expect(corrupt!.metadata).toEqual({});
  });
});
