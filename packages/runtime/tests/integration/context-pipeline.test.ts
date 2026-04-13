// File: packages/runtime/tests/integration/context-pipeline.test.ts
//
// Integration tests for the Context Engine pipeline:
//   1. ExperienceStore record/query cycle
//   2. ALWAYS_INCLUDE_TOOLS stays empty by default for sub-agents
//   3. context-status handler returns accurate snapshot
//   4. shouldShowTaskComplete visibility gating

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  ExperienceStore,
  ExperienceStoreLive,
  MemoryDatabaseLive,
  defaultMemoryConfig,
} from "@reactive-agents/memory";
import {
  ALWAYS_INCLUDE_TOOLS,
  makeContextStatusHandler,
  shouldShowTaskComplete,
} from "@reactive-agents/tools";
import type { ContextStatusState, TaskCompleteVisibility } from "@reactive-agents/tools";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const dbLayer = MemoryDatabaseLive(defaultMemoryConfig("integration-test-agent"));
const experienceLayer = ExperienceStoreLive.pipe(Layer.provide(dbLayer));

// ─── Test 1: ExperienceStore record/query cycle ───────────────────────────────

describe("ExperienceStore record/query cycle", () => {
  it("records entries and returns tips after 2+ occurrences", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* ExperienceStore;

          // Record same taskType + toolsUsed twice so occurrences >= 2 and confidence >= 0.5
          const baseEntry = {
            agentId: "test-agent",
            taskDescription: "write a report to a file",
            taskType: "file-write-task",
            toolsUsed: ["file-write"] as readonly string[],
            success: true,
            totalSteps: 4,
            totalTokens: 800,
            errors: [] as readonly { tool: string; error: string; recovery?: string }[],
            modelTier: "mid",
          };

          yield* store.record(baseEntry);
          yield* store.record({ ...baseEntry, totalSteps: 5, totalTokens: 900 });

          // Third entry with same taskType but different tools — should not affect our pattern
          yield* store.record({
            ...baseEntry,
            toolsUsed: ["web-search"],
            totalSteps: 6,
            totalTokens: 1200,
          });

          return yield* store.query("write a file", "file-write-task", "mid");
        }).pipe(Effect.provide(experienceLayer)),
      ),
    );

    // Tips should be non-empty (our pattern has 2 occurrences, confidence 1.0)
    expect(result.tips.length).toBeGreaterThan(0);

    // At least one tip should mention our tool
    const tipText = result.tips.join(" ");
    expect(tipText).toContain("file-write");

    // toolPatterns should have the file-write entry with occurrences >= 2
    const fileWritePattern = result.toolPatterns.find((p) =>
      p.pattern.includes("file-write"),
    );
    expect(fileWritePattern).toBeDefined();
    expect(fileWritePattern!.occurrences).toBeGreaterThanOrEqual(2);
    expect(fileWritePattern!.confidence).toBeGreaterThanOrEqual(0.5);
  });
});

// ─── Test 2: ALWAYS_INCLUDE_TOOLS constant ────────────────────────────────────

describe("ALWAYS_INCLUDE_TOOLS", () => {
  it("is empty by default", () => {
    expect(ALWAYS_INCLUDE_TOOLS).toEqual([]);
  });
});

// ─── Test 3: context-status returns accurate snapshot ────────────────────────

describe("makeContextStatusHandler", () => {
  it("returns correct remaining count and pending tools", async () => {
    const state: ContextStatusState = {
      iteration: 3,
      maxIterations: 10,
      toolsUsed: new Set(["file-write"]),
      requiredTools: ["file-write", "web-search"],
    };

    const handler = makeContextStatusHandler(state);
    const snapshot = await Effect.runPromise(handler({})) as {
      iteration: number;
      maxIterations: number;
      remaining: number;
      toolsUsed: string[];
      toolsPending: string[];
      storedKeys: string[];
      tokensUsed: number;
    };

    expect(snapshot.remaining).toBe(7);
    expect(snapshot.toolsPending).toEqual(["web-search"]);
    expect(snapshot.toolsUsed).toEqual(["file-write"]);
  });
});

// ─── Test 4: shouldShowTaskComplete visibility gating ────────────────────────

describe("shouldShowTaskComplete", () => {
  const base: TaskCompleteVisibility = {
    requiredToolsCalled: new Set(["file-write"]),
    requiredTools: ["file-write"],
    iteration: 3,
    hasErrors: false,
    hasNonMetaToolCalled: true,
  };

  it("is hidden at iteration 0 (too early)", () => {
    const result = shouldShowTaskComplete({ ...base, iteration: 0 });
    expect(result).toBe(false);
  });

  it("is hidden when errors are present (even at iteration 3)", () => {
    const result = shouldShowTaskComplete({ ...base, hasErrors: true });
    expect(result).toBe(false);
  });

  it("is hidden when no non-meta tool has been called (even at iteration 3)", () => {
    const result = shouldShowTaskComplete({ ...base, hasNonMetaToolCalled: false });
    expect(result).toBe(false);
  });

  it("is visible when all conditions are met", () => {
    const result = shouldShowTaskComplete(base);
    expect(result).toBe(true);
  });
});
