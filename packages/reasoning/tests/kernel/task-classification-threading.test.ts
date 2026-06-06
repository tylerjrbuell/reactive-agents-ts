import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { classifyTask } from "../../src/kernel/capabilities/comprehend/task-classification.js";
import type { TaskClassification } from "../../src/kernel/capabilities/comprehend/task-classification.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

// HS-cleanup-2 — TaskClassification threading invariants.
//
// Canonical contract (sweep-2026-05-23 advisor consultation):
//   "Task classified once upstream; all consumers read from a single snapshot
//    threaded through strategy inputs."
//
// These tests verify:
//   (1) `classifyTask(task)` is pure + deterministic — repeated calls produce
//       identical TaskClassification structs.
//   (2) ToT entry honors an injected `taskClassification` snapshot (uses the
//       upstream verdict, does not re-classify).
//   (3) Adaptive entry threads its snapshot to the dispatched sub-strategy.

describe("classifyTask — single canonical classifier", () => {
  test("is pure: same input → identical output", () => {
    const a = classifyTask("What is the capital of France?");
    const b = classifyTask("What is the capital of France?");
    expect(a).toEqual(b);
  });

  test("returns both complexity and intent", () => {
    const r = classifyTask("Output a markdown table of currency prices.");
    expect(r.complexity).toBeDefined();
    expect(r.complexity.complexity).toMatch(/trivial|moderate|complex/);
    expect(r.intent).toBeDefined();
    // Markdown table cue should be detected as the intent format.
    expect(r.intent.format).toBe("markdown");
  });
});

describe("ToT honors threaded TaskClassification (HS-cleanup-2)", () => {
  test("an injected COMPLEX classification overrides what a string-based classifier would say", async () => {
    // The task string "What is 17 × 23" would normally classify as trivial
    // (math pattern, confidence 0.9) and trip the BFS skip gate. With an
    // injected complex classification, ToT must NOT skip — it should honor
    // the upstream snapshot.
    const layer = TestLLMServiceLayer([
      { match: "Generate exactly", text: "1. Direct calculation\n2. Long multiplication" },
      { match: "Rate each", text: "0.7" },
      { match: "Selected Approach", text: "FINAL ANSWER: 391." },
    ]);

    const injectedComplex: TaskClassification = {
      complexity: {
        complexity: "complex",
        reason: "test-injected-override",
        confidence: 0.95,
      },
      intent: { format: null, cues: [], expectedContent: [], expectedEntities: [] },
    };

    const result = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: "What is 17 × 23?",
        taskType: "math",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
        taskClassification: injectedComplex,
      }).pipe(Effect.provide(layer)),
    );

    const md = result.metadata as Record<string, unknown>;
    // BFS was NOT skipped — proves ToT read the injected snapshot, not its own.
    expect(md.bfsSkipped).toBeUndefined();
    // The full BFS marker is present in steps.
    const bfsMarker = result.steps.find((s) =>
      s.content.includes("Starting tree exploration"),
    );
    expect(bfsMarker).toBeDefined();
  });

  test("an injected TRIVIAL classification on a complex-looking task forces the skip", async () => {
    // Inverse: task string that would normally classify as complex (trade-offs
    // keyword), but injected trivial classification forces the skip path.
    const layer = TestLLMServiceLayer([
      { match: "trade-offs", text: "Eventual is fast; strong is consistent." },
    ]);

    const injectedTrivial: TaskClassification = {
      complexity: {
        complexity: "trivial",
        reason: "test-injected-override",
        confidence: 0.95,
      },
      intent: { format: null, cues: [], expectedContent: [], expectedEntities: [] },
    };

    const result = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription:
          "Compare the trade-offs between eventual and strong consistency in distributed databases.",
        taskType: "analysis",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
        taskClassification: injectedTrivial,
      }).pipe(Effect.provide(layer)),
    );

    const md = result.metadata as Record<string, unknown>;
    expect(md.bfsSkipped).toBe(true);
    expect(md.bfsSkipReason).toBe("test-injected-override");
  });
});

describe("Adaptive threads classification to dispatched sub-strategy", () => {
  test("trivial classification routes to reactive (heuristic uses threaded snapshot)", async () => {
    const layer = TestLLMServiceLayer([
      { match: "capital of France", text: "Paris is the capital of France." },
    ]);

    // Inject classification — adaptive heuristic must use it without recomputing.
    const injected: TaskClassification = {
      complexity: {
        complexity: "trivial",
        reason: "upstream-injected",
        confidence: 0.95,
      },
      intent: { format: null, cues: [], expectedContent: [], expectedEntities: [] },
    };

    const result = await Effect.runPromise(
      executeAdaptive({
        taskDescription: "What is the capital of France?",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
        taskClassification: injected,
      }).pipe(Effect.provide(layer)),
    );

    const md = result.metadata as Record<string, unknown>;
    expect(md.selectedStrategy).toBe("reactive");
  });
});
