// File: tests/context/context-budget.test.ts
import { describe, it, expect } from "bun:test";
import {
  allocateBudget,
  estimateTokens,
  wouldExceedBudget,
  trackUsage,
} from "../../src/context/context-budget.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("hello")).toBe(2); // ceil(5/4)
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

describe("allocateBudget", () => {
  it("allocates budget proportionally for local tier", () => {
    const budget = allocateBudget(4000, CONTEXT_PROFILES.local, 0, 10);
    // Local: 70% usable = 2800, 20% reserve = 560, available = 2240
    expect(budget.totalBudget).toBe(4000);
    expect(budget.reserveOutput).toBeGreaterThan(0);
    // All sections should have positive allocations
    expect(budget.allocated.systemPrompt).toBeGreaterThan(0);
    expect(budget.allocated.toolSchemas).toBeGreaterThan(0);
    expect(budget.allocated.memoryContext).toBeGreaterThan(0);
    expect(budget.allocated.stepHistory).toBeGreaterThan(0);
    expect(budget.allocated.rules).toBeGreaterThan(0);
    // stepHistory should be the largest section for local
    expect(budget.allocated.stepHistory).toBeGreaterThan(budget.allocated.systemPrompt);
  });

  it("allocates budget proportionally for frontier tier", () => {
    const budget = allocateBudget(128000, CONTEXT_PROFILES.frontier, 0, 15);
    expect(budget.totalBudget).toBe(128000);
    // Frontier gets smaller reserve
    const localBudget = allocateBudget(128000, CONTEXT_PROFILES.local, 0, 10);
    expect(budget.reserveOutput).toBeLessThan(localBudget.reserveOutput);
  });

  it("shifts budget toward stepHistory as iterations progress", () => {
    const early = allocateBudget(8000, CONTEXT_PROFILES.mid, 0, 10);
    const late = allocateBudget(8000, CONTEXT_PROFILES.mid, 9, 10);
    // Late iterations should have more step history budget
    expect(late.allocated.stepHistory).toBeGreaterThan(early.allocated.stepHistory);
  });

  it("all used counters start at zero", () => {
    const budget = allocateBudget(4000, CONTEXT_PROFILES.mid, 0, 10);
    expect(budget.used.systemPrompt).toBe(0);
    expect(budget.used.toolSchemas).toBe(0);
    expect(budget.used.memoryContext).toBe(0);
    expect(budget.used.stepHistory).toBe(0);
    expect(budget.used.rules).toBe(0);
  });
});

describe("wouldExceedBudget", () => {
  it("returns false when within budget", () => {
    const budget = allocateBudget(10000, CONTEXT_PROFILES.mid, 0, 10);
    expect(wouldExceedBudget(budget, "systemPrompt", 10)).toBe(false);
  });

  it("returns true when exceeding allocated section", () => {
    const budget = allocateBudget(100, CONTEXT_PROFILES.local, 0, 10);
    // Allocations will be very small for 100 total tokens
    expect(wouldExceedBudget(budget, "systemPrompt", 99999)).toBe(true);
  });
});

describe("trackUsage", () => {
  it("updates used counters and remaining", () => {
    const budget = allocateBudget(10000, CONTEXT_PROFILES.mid, 0, 10);
    const text = "a".repeat(400); // ~100 tokens
    const updated = trackUsage(budget, "systemPrompt", text);
    expect(updated.used.systemPrompt).toBe(100);
    expect(updated.remaining).toBeLessThan(budget.remaining);
  });

  it("accumulates usage across multiple calls", () => {
    let budget = allocateBudget(10000, CONTEXT_PROFILES.mid, 0, 10);
    budget = trackUsage(budget, "systemPrompt", "a".repeat(40)); // 10 tokens
    budget = trackUsage(budget, "systemPrompt", "b".repeat(40)); // 10 more
    expect(budget.used.systemPrompt).toBe(20);
  });
});
