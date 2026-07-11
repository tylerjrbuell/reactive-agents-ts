// Run: bun test packages/reasoning/src/strategies/plan-execute-honest-partial.integration.test.ts --timeout 20000
//
// #40 / spec §1b (CompletionEnvelope) — plan-execute joins the sub-kernel
// completion envelope at the result boundary.
//
// Before #40, plan-execute derived `status: finalOutput ? "completed" :
// "partial"` from OUTPUT PRESENCE (plan-execute.ts return block), and
// `executeReActKernel` dropped `meta.budgetTerminalPartial` /
// `harnessAuthoredOutput` / `verificationWarning` entirely — so a composite
// step whose sub-kernel shipped a budget-terminal honest partial rode out of
// the strategy as `completed` (success === true downstream). These tests pin
// the envelope JOIN: strip `capStatusToEnvelope`/`honestEnvelopeMetadata` at
// the plan-execute return site and they go red.
//
// Scenario mirrors honest-partial.integration.test.ts: research task naming
// report.md (compiles a deterministic OUTSTANDING artifact requirement — the
// pace-band precondition), one COMPOSITE plan step, tokenLimit:1 + long
// horizon so the sub-kernel's terminal pace band forces a synthesis one notch
// before the budget cliff (meta.budgetTerminalPartial = true). The reflect
// pass then reports SATISFIED — plan-execute's own authority ACCEPTS — and
// only the envelope join makes the honest partial reach the caller.

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executePlanExecute } from "./plan-execute.js";
import { defaultReasoningConfig } from "../types/config.js";
import { succeedingToolLayer } from "../testing/tool-service-mock.js";

const GATHER_SCHEMA = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", required: true }],
};
// Second scoped tool that is never called, so the composite sub-kernel's
// exitOnAllToolsCalled cannot fire after the first gather — the loop reaches
// the next iteration start, where the terminal pace band pre-empts.
const AUDIT_SCHEMA = {
  name: "audit",
  description: "audit gathered data",
  parameters: [{ name: "q", type: "string", required: true }],
};

const gatherToolLayer = succeedingToolLayer(
  { finding: "KEY FACT: the topic's core metric rose 12% last quarter." },
  GATHER_SCHEMA.parameters,
);

// One COMPOSITE step → executed via executeReActKernel (the #40 boundary).
const PLAN = {
  steps: [
    {
      title: "Research and draft",
      instruction:
        "Research the topic with the scoped tools and draft the findings for report.md.",
      type: "composite",
      toolHints: ["gather", "audit"],
    },
  ],
};

const TASK = "Research the topic thoroughly and write your findings to report.md.";

const budgetScenario = () =>
  TestLLMServiceLayer([
    // 1. plan generation (completeStructured) — first call, unconditional.
    { json: PLAN },
    // 2. composite sub-kernel think → gather call (burns tokens past the cliff).
    { match: "report\\.md", toolCall: { name: "gather", args: { q: "topic" } } },
    // 3. forced terminal synthesis (long-horizon pace band; prompt says "professional").
    { match: "professional", text: "SYNTHESIZED REPORT: the metric rose 12% last quarter." },
    // 4. REFLECT — plan-execute's OWN authority accepts.
    { match: "STEP RESULTS", text: "SATISFIED: the goal is fully addressed." },
    // 5. final SYNTHESIZE (+ quality gate, if it fires).
    { text: "FINAL REPORT: the metric rose 12% last quarter." },
  ]);

// CONTROL plan/task — mirrors the reactive control ("What is 2 + 2?"): a
// trivial task with NO deliverable/artifact expectation, so the composite
// sub-kernel terminates on a clean model-authored final answer (a report.md
// task would drive the completion guard into a harness-deliverable stall —
// which the envelope CORRECTLY reports as partial, but that is the treatment
// arm, not a control).
const CONTROL_PLAN = {
  steps: [
    {
      title: "Answer",
      instruction: "Answer the question directly.",
      type: "composite",
    },
  ],
};
const CONTROL_TASK = "What is 2 + 2?";

const cleanScenario = () =>
  TestLLMServiceLayer([
    { json: CONTROL_PLAN },
    // Composite sub-kernel think → clean model-authored final answer.
    { match: "2 \\+ 2", text: "FINAL ANSWER: 4." },
    { match: "STEP RESULTS", text: "SATISFIED: the question is answered." },
    { text: "FINAL REPORT: 4." },
  ]);

const runPlanExecute = (
  scenario: ReturnType<typeof TestLLMServiceLayer>,
  extra: Record<string, unknown>,
) =>
  Effect.runPromise(
    executePlanExecute({
      taskDescription: TASK,
      taskType: "research",
      memoryContext: "",
      availableTools: ["gather", "audit"],
      availableToolSchemas: [GATHER_SCHEMA, AUDIT_SCHEMA],
      config: defaultReasoningConfig,
      ...extra,
    } as never).pipe(Effect.provide(Layer.merge(scenario, gatherToolLayer))),
  );

describe("#40 (plan-execute) — a sub-kernel's unverified ship never reaches the caller as completed", () => {
  it("budget-terminal partial in a composite step: result.status is PARTIAL with the honesty metadata", async () => {
    const result = await runPlanExecute(budgetScenario(), {
      horizonProfile: "long",
      budgetLimits: { tokenLimit: 1 },
    });

    // Real work is preserved…
    expect(result.output).toBeTruthy();
    // …but the reflect pass's SATISFIED cannot upgrade past the sub-kernel
    // envelope: the caller is told the truth.
    expect(result.status).toBe("partial");
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.budgetTerminalPartial).toBe(true);
    expect(String(meta.verificationWarning ?? "")).toContain("report.md");
  });

  it("CONTROL: a clean composite run still reports completed with no honesty markers", async () => {
    const result = await runPlanExecute(cleanScenario(), {
      taskDescription: CONTROL_TASK,
      taskType: "qa",
      availableTools: [],
      availableToolSchemas: [],
    });
    expect(result.status).toBe("completed");
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.budgetTerminalPartial).toBeUndefined();
    expect(meta.harnessAuthoredOutput).toBeUndefined();
  });
});
