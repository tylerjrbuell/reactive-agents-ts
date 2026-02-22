import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createEvalStore } from "../src/services/eval-store.js";
import { Effect } from "effect";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "./test-eval-store.db";

describe("Smoke: EvalStore Persistence", () => {
  beforeEach(() => {
    // Clean up before each test
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (existsSync(`${TEST_DB}-wal`)) unlinkSync(`${TEST_DB}-wal`);
    if (existsSync(`${TEST_DB}-shm`)) unlinkSync(`${TEST_DB}-shm`);
  });

  afterEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (existsSync(`${TEST_DB}-wal`)) unlinkSync(`${TEST_DB}-wal`);
    if (existsSync(`${TEST_DB}-shm`)) unlinkSync(`${TEST_DB}-shm`);
  });

  const makeRun = (id: string, suiteId: string, scores: Record<string, number>) => ({
    id,
    suiteId,
    timestamp: new Date(),
    agentConfig: "test-agent",
    results: [{
      caseId: "case-1",
      timestamp: new Date(),
      agentConfig: "test-agent",
      scores: Object.entries(scores).map(([dimension, score]) => ({ dimension, score })),
      overallScore: Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length,
      actualOutput: "Test output",
      latencyMs: 100,
      costUsd: 0.001,
      tokensUsed: 50,
      stepsExecuted: 1,
      passed: true,
    }],
    summary: {
      totalCases: 1,
      passed: 1,
      failed: 0,
      avgScore: Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length,
      avgLatencyMs: 100,
      totalCostUsd: 0.001,
      dimensionAverages: scores,
    },
  });

  it("saveRun → loadHistory returns saved run", async () => {
    const store = createEvalStore(TEST_DB);
    const run = makeRun("run-1", "suite-a", { accuracy: 0.9, relevance: 0.85 });

    await Effect.runPromise(store.saveRun(run));
    const history = await Effect.runPromise(store.loadHistory("suite-a"));

    expect(history.length).toBe(1);
    expect(history[0].id).toBe("run-1");
    expect(history[0].suiteId).toBe("suite-a");
    expect(history[0].results.length).toBe(1);
    expect(history[0].summary.avgScore).toBeCloseTo(0.875, 2);
  });

  it("compareRuns detects dimension changes", async () => {
    const store = createEvalStore(TEST_DB);
    const run1 = makeRun("run-1", "suite-a", { accuracy: 0.7, relevance: 0.6 });
    const run2 = makeRun("run-2", "suite-a", { accuracy: 0.9, relevance: 0.5 });

    await Effect.runPromise(store.saveRun(run1));
    await Effect.runPromise(store.saveRun(run2));

    const comparison = await Effect.runPromise(store.compareRuns("run-1", "run-2"));
    expect(comparison).not.toBeNull();
    expect(comparison!.improved).toContain("accuracy");
    expect(comparison!.regressed).toContain("relevance");
  });

  it("loadRun returns null for unknown ID", async () => {
    const store = createEvalStore(TEST_DB);
    const result = await Effect.runPromise(store.loadRun("nonexistent"));
    expect(result).toBeNull();
  });

  it("history survives across store instances", async () => {
    const store1 = createEvalStore(TEST_DB);
    const run = makeRun("run-persist", "suite-b", { accuracy: 0.95 });
    await Effect.runPromise(store1.saveRun(run));

    // Create a new store instance pointing to same DB
    const store2 = createEvalStore(TEST_DB);
    const history = await Effect.runPromise(store2.loadHistory("suite-b"));
    expect(history.length).toBe(1);
    expect(history[0].id).toBe("run-persist");
  });

  it("loadHistory respects limit option", async () => {
    const store = createEvalStore(TEST_DB);
    for (let i = 0; i < 5; i++) {
      await Effect.runPromise(
        store.saveRun(makeRun(`run-${i}`, "suite-c", { accuracy: 0.8 + i * 0.01 })),
      );
    }

    const limited = await Effect.runPromise(store.loadHistory("suite-c", { limit: 2 }));
    expect(limited.length).toBe(2);
  });
});
