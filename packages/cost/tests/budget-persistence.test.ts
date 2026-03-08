import { describe, test, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import { makeBudgetEnforcer, type BudgetEnforcer } from "../src/budgets/budget-enforcer.js";
import { makeBudgetDb, todayKey, monthKey, type BudgetDb } from "../src/budgets/budget-db.js";
import type { BudgetLimits } from "../src/types.js";
import { existsSync, unlinkSync } from "node:fs";

const TEST_DB = "/tmp/budget-persist-test.db";

const testLimits: BudgetLimits = {
  perRequest: 1.0,
  perSession: 5.0,
  daily: 25.0,
  monthly: 200.0,
};

afterEach(() => {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }
});

describe("Budget Persistence (SQLite)", () => {
  test("BudgetDb stores and loads spend", async () => {
    const spend = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeBudgetDb(TEST_DB);
        yield* db.addSpend("agent-1", "daily:2026-03-06", 3.50);
        yield* db.addSpend("agent-1", "daily:2026-03-06", 1.25);
        const total = yield* db.loadSpend("agent-1", "daily:2026-03-06");
        yield* db.close();
        return total;
      }),
    );
    expect(spend).toBe(4.75);
  });

  test("BudgetDb returns 0 for unknown agent/period", async () => {
    const spend = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeBudgetDb(TEST_DB);
        const s = yield* db.loadSpend("unknown", "daily:2099-01-01");
        yield* db.close();
        return s;
      }),
    );
    expect(spend).toBe(0);
  });

  test("record() writes through to SQLite", async () => {
    // Record some costs, then reopen DB and verify persistence
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeBudgetDb(TEST_DB);
        const budget = yield* makeBudgetEnforcer(testLimits, db);
        yield* budget.record(2.50, "agent-1", "sess-1");
        yield* budget.record(1.00, "agent-1", "sess-1");
        yield* db.close();
      }),
    );

    // Reopen and verify
    const [daily, monthly] = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeBudgetDb(TEST_DB);
        const d = yield* db.loadSpend("agent-1", `daily:${todayKey()}`);
        const m = yield* db.loadSpend("agent-1", `monthly:${monthKey()}`);
        yield* db.close();
        return [d, m] as const;
      }),
    );
    expect(daily).toBe(3.50);
    expect(monthly).toBe(3.50);
  });

  test("hydrate() restores persisted state", async () => {
    // Pre-populate SQLite
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeBudgetDb(TEST_DB);
        yield* db.addSpend("agent-1", `daily:${todayKey()}`, 7.00);
        yield* db.addSpend("agent-1", `monthly:${monthKey()}`, 42.00);
        yield* db.close();
      }),
    );

    // New enforcer hydrates from DB
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeBudgetDb(TEST_DB);
        const budget = yield* makeBudgetEnforcer(testLimits, db);
        yield* budget.hydrate("agent-1");
        const s = yield* budget.getStatus("agent-1");
        yield* db.close();
        return s;
      }),
    );

    expect(status.currentDaily).toBe(7.00);
    expect(status.currentMonthly).toBe(42.00);
  });

  test("hydrate() is no-op without db", async () => {
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* makeBudgetEnforcer(testLimits);
        yield* budget.hydrate("agent-1"); // should not throw
        return yield* budget.getStatus("agent-1");
      }),
    );
    expect(status.currentDaily).toBe(0);
    expect(status.currentMonthly).toBe(0);
  });

  test("persisted daily resets with new date key", async () => {
    // Write spend for yesterday's key
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeBudgetDb(TEST_DB);
        yield* db.addSpend("agent-1", "daily:2025-01-01", 15.00);
        yield* db.addSpend("agent-1", `monthly:${monthKey()}`, 15.00);
        yield* db.close();
      }),
    );

    // Hydrate for today — daily should be 0 (different key), monthly should persist
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* makeBudgetDb(TEST_DB);
        const budget = yield* makeBudgetEnforcer(testLimits, db);
        yield* budget.hydrate("agent-1");
        const s = yield* budget.getStatus("agent-1");
        yield* db.close();
        return s;
      }),
    );

    expect(status.currentDaily).toBe(0);
    expect(status.currentMonthly).toBe(15.00);
  });
});
