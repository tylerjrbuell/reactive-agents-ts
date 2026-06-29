// File: tests/strategies/tot-cost-gate.test.ts
//
// HS-110 / M3 cost gate (sweep-2026-05-23) — ToT skips BFS exploration for
// trivial tasks. Verifies the gate fires + carries skip metadata, and
// verifies the kill-switch (skipBfsForTrivial: false) restores full BFS.

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("HS-110 — ToT cost gate skips BFS for trivial tasks", () => {
  it("skips BFS on a trivial-classified task and reports bfsSkipped metadata", async () => {
    // No expansion / score prompts intentionally — if BFS ran, the kernel
    // would call the LLM for expansion + scoring and TestLLM's default
    // "Test response" would not match any branch. With the gate firing, the
    // strategy goes straight to the react kernel.
    const layer = TestLLMServiceLayer([
      // The react kernel's final synthesis call matches against the
      // taskDescription so we seed an answer here.
      { match: "What is the capital of France", text: "Paris is the capital of France." },
    ]);

    const result = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: "What is the capital of France?",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        // skipBfsForTrivial is undefined here — default-on semantics apply.
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("tree-of-thought");
    // The skip path goes through the same buildStrategyResult, so success
    // status depends on whether the react kernel produced output. Either way,
    // the bfsSkipped metadata MUST be set so trace consumers can attribute
    // cost differences correctly.
    const metadata = result.metadata as Record<string, unknown>;
    expect(metadata.bfsSkipped).toBe(true);
    expect(typeof metadata.bfsSkipReason).toBe("string");
    expect(typeof metadata.bfsSkipConfidence).toBe("number");

    // No BFS phase steps should appear when the gate fires — the strategy
    // emits a single `[TOT] BFS exploration skipped` observation then
    // delegates to the react kernel.
    const bfsExpansionSteps = result.steps.filter((s) =>
      s.content.includes("Starting tree exploration"),
    );
    expect(bfsExpansionSteps.length).toBe(0);
    const skipMarker = result.steps.find((s) =>
      s.content.includes("BFS exploration skipped"),
    );
    expect(skipMarker).toBeDefined();
  });

  it("runs full BFS when skipBfsForTrivial: false even on a trivial task", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Generate exactly", text: "1. Geographical lookup\n2. Cultural knowledge" },
      { match: "Rate each", text: "0.8" },
      { match: "Selected Approach", text: "FINAL ANSWER: Paris." },
    ]);

    const result = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: "What is the capital of France?",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            treeOfThought: {
              breadth: 2,
              depth: 2,
              pruningThreshold: 0.3,
              skipBfsForTrivial: false,
            },
          },
        },
      }).pipe(Effect.provide(layer)),
    );

    const metadata = result.metadata as Record<string, unknown>;
    expect(metadata.bfsSkipped).toBeUndefined();

    // Full BFS — must emit the "Starting tree exploration" marker.
    const bfsExpansionSteps = result.steps.filter((s) =>
      s.content.includes("Starting tree exploration"),
    );
    expect(bfsExpansionSteps.length).toBe(1);
  });

  it("runs full BFS on a complex-classified task even with default config", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Generate exactly", text: "1. Consistency model trade-offs\n2. Latency-vs-availability trade-offs" },
      { match: "Rate each", text: "0.8" },
      { match: "Selected Approach", text: "FINAL ANSWER: Strong vs eventual consistency analysis." },
    ]);

    const result = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: "Compare the trade-offs between eventual consistency and strong consistency.",
        taskType: "analysis",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig, // default — gate is on but task is complex
      }).pipe(Effect.provide(layer)),
    );

    const metadata = result.metadata as Record<string, unknown>;
    // Complex task must NOT be skipped.
    expect(metadata.bfsSkipped).toBeUndefined();
    const bfsExpansionSteps = result.steps.filter((s) =>
      s.content.includes("Starting tree exploration"),
    );
    expect(bfsExpansionSteps.length).toBe(1);
  });
});

// ── Explore wall-clock guard (graceful degradation) ──────────────────────────
// 2026-06-29 cross-tier sweep: ToT explore on slow thinking models ran 270s+,
// leaving no time for Phase 2 before the external timeout killed the run → 0
// output (gemini-2.5-pro / qwen3:14b on e3-logic-fallacy). The explore phase
// must self-bound on wall-clock so Phase 2 always runs and emits best-so-far.
describe("ToT explore wall-clock guard (graceful degradation)", () => {
  it("bounds exploration on the wall-clock budget and still executes the best path", async () => {
    const prev = process.env.RA_TOT_EXPLORE_BUDGET_MS;
    process.env.RA_TOT_EXPLORE_BUDGET_MS = "0"; // budget exhausted immediately
    try {
      const layer = TestLLMServiceLayer([
        { match: "Generate exactly", text: "1. approach A\n2. approach B" },
        { match: "Rate each", text: "0.8" },
        { match: "Selected Approach", text: "FINAL ANSWER: bounded but answered." },
      ]);
      const result = await Effect.runPromise(
        executeTreeOfThought({
          taskDescription: "Compare the trade-offs between eventual and strong consistency.",
          taskType: "analysis",
          memoryContext: "",
          availableTools: [],
          config: defaultReasoningConfig,
        }).pipe(Effect.provide(layer)),
      );
      // The wall-clock guard must have fired...
      const marker = result.steps.find((s) => s.content.includes("Wall-clock guard"));
      expect(marker).toBeDefined();
      // ...and Phase 2 must still have produced output (graceful degradation, not 0).
      expect((result.output ?? "").length).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) delete process.env.RA_TOT_EXPLORE_BUDGET_MS;
      else process.env.RA_TOT_EXPLORE_BUDGET_MS = prev;
    }
  });
});
