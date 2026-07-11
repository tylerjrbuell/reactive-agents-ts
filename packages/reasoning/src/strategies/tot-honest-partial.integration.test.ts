// Run: bun test packages/reasoning/src/strategies/tot-honest-partial.integration.test.ts --timeout 20000
//
// H5 for tree-of-thought — the honest-partial channel, pinned AT THE RESULT
// BOUNDARY (companion to honest-partial.integration.test.ts, which covers
// reactive/direct). Before 2026-07-10 ToT mapped `status: finalOutput ?
// "completed" : "partial"` from output PRESENCE, so a harness-authored or
// budget-terminal ship rode out as `completed`. And ToT never threaded
// `horizonProfile` into its branch kernels, so A2's long-horizon budget
// discipline — the very thing that produces the budget-terminal partial —
// could not fire on any ToT run.
//
// These assert on the ReasoningResult the caller receives, and fail if ToT
// stops routing through resolveCompletionStatus OR stops threading the horizon
// profile (either regression makes the partial read as completed).
//
// The scenario mirrors honest-partial.integration.test.ts (research task,
// gather tool, budget cliff at tokenLimit:1) but drives ToT's cost-gated SKIP
// path — the same react branch kernel — via an injected trivial classification,
// so it stays one deterministic kernel pass instead of the multi-turn BFS.

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeTreeOfThought } from "./tree-of-thought.js";
import { defaultReasoningConfig } from "../types/config.js";
import { succeedingToolLayer } from "../testing/tool-service-mock.js";
import { classifyTask } from "../kernel/capabilities/comprehend/task-classification.js";

const GATHER_SCHEMA = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", required: true }],
};

const gatherToolLayer = succeedingToolLayer(
  { finding: "KEY FACT: the topic's core metric rose 12% last quarter." },
  GATHER_SCHEMA.parameters,
);

const scenario = () =>
  TestLLMServiceLayer([
    { match: "report\\.md", toolCall: { name: "gather", args: { q: "topic" } } },
    { match: "professional", text: "SYNTHESIZED REPORT: the metric rose 12% last quarter." },
    { text: "FINAL ANSWER: unsynthesized guess." },
  ]);

const TASK = "Research the topic thoroughly and write your findings to report.md.";

// Injected trivial classification forces ToT's skip path (a single react
// branch kernel). taskClassification is a legitimate strategy input — the
// engine threads it from the upstream comprehend pass.
const FORCE_SKIP = classifyTask("What is 2 + 2?");

const runToT = (extra: Record<string, unknown>) =>
  Effect.runPromise(
    executeTreeOfThought({
      taskDescription: TASK,
      taskType: "research",
      memoryContext: "",
      availableTools: ["gather"],
      availableToolSchemas: [GATHER_SCHEMA],
      taskClassification: FORCE_SKIP,
      config: defaultReasoningConfig,
      maxIterations: 6,
      ...extra,
    } as never).pipe(Effect.provide(Layer.merge(scenario(), gatherToolLayer))),
  );

describe("H5 (tree-of-thought) — an unverified ship never reaches the caller as completed", () => {
  it("budget-terminal partial under long horizon: result.status is PARTIAL", async () => {
    const result = await runToT({
      horizonProfile: "long",
      budgetLimits: { tokenLimit: 1 },
    });
    // Real work is preserved…
    expect(result.output).toBeTruthy();
    // …but the caller is told the truth. This is the flag the user sees
    // (success = status === "completed", reasoning-post-think.ts:85).
    expect(result.status).toBe("partial");
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.budgetTerminalPartial).toBe(true);
  });

  it("CONTROL: without the long-horizon thread the budget partial cannot form", async () => {
    // Same budget cliff, but no horizonProfile. This pins the SECOND half of
    // the fix: if ToT stops threading horizonProfile, the long-horizon pace
    // band never arms and this run cannot produce the honest partial — the
    // regression this control guards against.
    const result = await runToT({ budgetLimits: { tokenLimit: 1 } });
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.budgetTerminalPartial).toBeUndefined();
  });
});
