import { describe, test, expect } from "bun:test";
import { classifyTaskComplexity } from "../../src/kernel/capabilities/comprehend/task-complexity.js";

// HS-110 / M3 — pre-execution complexity classifier (sweep-2026-05-23).
//
// Gates ToT BFS exploration. Trivial → skip BFS, collapse to reactive.
// Moderate → BFS allowed. Complex → BFS forced (or at least not skipped).

describe("classifyTaskComplexity — trivial verdicts", () => {
  test("single-fact lookup ('what is the capital of France')", () => {
    const r = classifyTaskComplexity("What is the capital of France?");
    expect(r.complexity).toBe("trivial");
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  test("single-step multiplication ('17 × 23')", () => {
    const r = classifyTaskComplexity("17 × 23");
    expect(r.complexity).toBe("trivial");
  });

  test("calculate phrasing ('calculate 17 * 23')", () => {
    const r = classifyTaskComplexity("Calculate 17 * 23");
    expect(r.complexity).toBe("trivial");
  });

  test("times phrasing ('what is 17 times 23')", () => {
    const r = classifyTaskComplexity("What is 17 times 23?");
    expect(r.complexity).toBe("trivial");
  });

  test("short prose (≤12 words, ≤80 chars) without multi-step signal", () => {
    const r = classifyTaskComplexity("Name three programming languages.");
    expect(r.complexity).toBe("trivial");
  });
});

describe("classifyTaskComplexity — moderate verdicts", () => {
  test("multi-step signal ('first do X then do Y')", () => {
    const r = classifyTaskComplexity("First fetch the user list then filter active users.");
    expect(r.complexity).toBe("moderate");
  });

  test("step-numbered task", () => {
    const r = classifyTaskComplexity("Step 1: Read the file. Step 2: Parse JSON.");
    expect(r.complexity).toBe("moderate");
  });

  test("plan-design indicator", () => {
    const r = classifyTaskComplexity("Plan a migration strategy for the legacy database.");
    // 'strategy' is a complex indicator, but 'plan a' multi-step fires first.
    expect(["moderate", "complex"]).toContain(r.complexity);
  });

  test("medium-length prose with no trivial cue defaults to moderate", () => {
    const r = classifyTaskComplexity(
      "Write a small TypeScript function that accepts an array of strings and returns the unique ones sorted alphabetically.",
    );
    expect(r.complexity).toBe("moderate");
  });
});

describe("classifyTaskComplexity — complex verdicts", () => {
  test("'critique' verb", () => {
    const r = classifyTaskComplexity("Critique the design of this authentication flow.");
    expect(r.complexity).toBe("complex");
  });

  test("'trade-offs' analysis prompt", () => {
    const r = classifyTaskComplexity("Compare the trade-offs between eventual and strong consistency.");
    expect(r.complexity).toBe("complex");
  });

  test("'why would you' open-ended analysis", () => {
    const r = classifyTaskComplexity("Why would you choose hash indexes over B-trees here?");
    expect(r.complexity).toBe("complex");
  });
});

describe("classifyTaskComplexity — edge cases", () => {
  test("empty input → moderate with 0 confidence (defensive)", () => {
    const r = classifyTaskComplexity("");
    expect(r.complexity).toBe("moderate");
    expect(r.confidence).toBe(0.0);
  });

  test("whitespace-only input → moderate", () => {
    const r = classifyTaskComplexity("   \n\t  ");
    expect(r.complexity).toBe("moderate");
  });

  test("complex indicator wins over trivial signals (force exploration)", () => {
    // Short + critique → complex. Word count < 12 would normally trip
    // short-prose trivial; complex-indicator must take precedence.
    const r = classifyTaskComplexity("Critique my plan.");
    expect(r.complexity).toBe("complex");
  });

  test("multi-step indicator wins over trivial short-prose", () => {
    const r = classifyTaskComplexity("Read it then summarize.");
    expect(r.complexity).toBe("moderate");
  });
});
