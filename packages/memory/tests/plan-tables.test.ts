import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import { MemoryDatabase, MemoryDatabaseLive } from "../src/database.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-plan-tables";
const TEST_DB = path.join(TEST_DB_DIR, "test.db");

afterEach(() => {
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
  try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}
  try { fs.rmSync(TEST_DB_DIR, { recursive: true }); } catch {}
});

describe("Plan SQLite tables", () => {
  it("creates plans table on database init", async () => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const layer = MemoryDatabaseLive(config);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* MemoryDatabase;
          return yield* db.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='plans'",
          );
        }).pipe(Effect.provide(layer)),
      ),
    );
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("plans");
  });

  it("creates plan_steps table on database init", async () => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const layer = MemoryDatabaseLive(config);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* MemoryDatabase;
          return yield* db.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='plan_steps'",
          );
        }).pipe(Effect.provide(layer)),
      ),
    );
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("plan_steps");
  });

  it("inserts and reads back a plan", async () => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const layer = MemoryDatabaseLive(config);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* MemoryDatabase;
          yield* db.exec(
            `INSERT INTO plans (id, task_id, agent_id, goal, mode, status, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ["p_test", "task-1", "agent-1", "Test goal", "linear", "active", 1, "2026-03-03T00:00:00Z", "2026-03-03T00:00:00Z"],
          );
          return yield* db.query<{ id: string; goal: string }>("SELECT id, goal FROM plans WHERE id = ?", ["p_test"]);
        }).pipe(Effect.provide(layer)),
      ),
    );
    expect(result.length).toBe(1);
    expect(result[0].goal).toBe("Test goal");
  });

  it("inserts plan steps with foreign key to plans", async () => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const layer = MemoryDatabaseLive(config);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* MemoryDatabase;
          yield* db.exec(
            `INSERT INTO plans (id, task_id, agent_id, goal, mode, status, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ["p_fk", "task-1", "agent-1", "FK test", "linear", "active", 1, "2026-03-03T00:00:00Z", "2026-03-03T00:00:00Z"],
          );
          yield* db.exec(
            `INSERT INTO plan_steps (id, plan_id, seq, title, instruction, type, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ["s1", "p_fk", 0, "Step 1", "Do something", "tool_call", "pending"],
          );
          return yield* db.query<{ id: string; title: string }>("SELECT id, title FROM plan_steps WHERE plan_id = ?", ["p_fk"]);
        }).pipe(Effect.provide(layer)),
      ),
    );
    expect(result.length).toBe(1);
    expect(result[0].title).toBe("Step 1");
  });
});
