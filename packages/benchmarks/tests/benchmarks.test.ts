// File: tests/benchmarks.test.ts
import { describe, it, expect } from "bun:test";
import { BENCHMARK_TASKS, getTasksByTier } from "../src/tasks.js";
import type { Tier, TaskResult } from "../src/types.js";

describe("Benchmark Tasks", () => {
  it("has 20 tasks", () => {
    expect(BENCHMARK_TASKS.length).toBe(20);
  });

  it("has 4 tasks per tier", () => {
    const tiers: Tier[] = ["trivial", "simple", "moderate", "complex", "expert"];
    for (const tier of tiers) {
      expect(getTasksByTier(tier).length).toBe(4);
    }
  });

  it("all tasks have unique IDs", () => {
    const ids = BENCHMARK_TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all tasks have non-empty prompts", () => {
    for (const task of BENCHMARK_TASKS) {
      expect(task.prompt.length).toBeGreaterThan(0);
    }
  });

  it("moderate+ tasks specify a strategy", () => {
    const strategyTiers: Tier[] = ["moderate", "complex", "expert"];
    for (const task of BENCHMARK_TASKS) {
      if (strategyTiers.includes(task.tier)) {
        expect(task.strategy).toBeDefined();
      }
    }
  });

  it("getTasksByTier filters correctly", () => {
    const trivial = getTasksByTier("trivial");
    expect(trivial.every((t) => t.tier === "trivial")).toBe(true);
  });
});
