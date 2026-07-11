// Run: bun test packages/reasoning/src/strategies/blueprint-honest-partial.integration.test.ts --timeout 20000
//
// #40 / spec §1b (CompletionEnvelope) — blueprint's budget-capped harness join
// is an honest partial.
//
// blueprint runs NO sub-kernel (0-LLM DAG worker + inline analysis calls), so
// its envelope derives per-path from the strategy's own DETERMINISTIC evidence
// (#40 rule 5). The path pinned here: token budget exhausted before SOLVE →
// the HARNESS joins the raw worker results (the model never authored the
// deliverable; the run terminated by budget, not by evidence). Before #40 that
// path shipped `status:"completed"` whenever every worker step succeeded.
// Strip the budgetCappedJoin cap / markers at blueprint's return site and
// these go red.

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeBlueprint } from "./blueprint.js";
import { defaultReasoningConfig } from "../types/config.js";
import { succeedingToolLayer } from "../testing/tool-service-mock.js";

const GATHER_SCHEMA = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", required: true }],
};

const gatherToolLayer = succeedingToolLayer(
  { finding: "KEY FACT: the topic's core metric rose 12% last quarter." },
  GATHER_SCHEMA.parameters,
);

// Two tool_call steps → multi-step plan (no single-step short-circuit), all
// steps succeed via the mocked ToolService, worker allSucceeded = true.
const PLAN = {
  steps: [
    {
      title: "Gather A",
      instruction: "Gather data on topic A",
      type: "tool_call",
      toolName: "gather",
      toolArgs: { q: "topic-a" },
    },
    {
      title: "Gather B",
      instruction: "Gather data on topic B",
      type: "tool_call",
      toolName: "gather",
      toolArgs: { q: "topic-b" },
    },
  ],
};

const TASK = "Research topics A and B and summarize the findings.";

const scenario = () =>
  TestLLMServiceLayer([
    // 1. plan generation (completeStructured) — first call.
    { json: PLAN },
    // 2. SOLVE (only reached when NOT over budget).
    { match: "Synthesize a clear, complete answer", text: "FINAL REPORT: A and B both rose 12%." },
    { text: "FINAL REPORT: A and B both rose 12%." },
  ]);

const runBlueprint = (extra: Record<string, unknown>) =>
  Effect.runPromise(
    executeBlueprint({
      taskDescription: TASK,
      taskType: "research",
      memoryContext: "",
      availableTools: ["gather"],
      availableToolSchemas: [GATHER_SCHEMA],
      config: defaultReasoningConfig,
      ...extra,
    } as never).pipe(Effect.provide(Layer.merge(scenario(), gatherToolLayer))),
  );

describe("#40 (blueprint) — the budget-capped harness join never reads as completed", () => {
  it("over-budget SOLVE skip: result.status is PARTIAL with the honesty metadata", async () => {
    // The plan-generation token estimate alone exceeds tokenLimit:1, so SOLVE
    // is skipped and the harness joins the raw worker results.
    const result = await runBlueprint({ budgetLimits: { tokenLimit: 1 } });

    // Real work is preserved (the joined worker results)…
    expect(result.output).toBeTruthy();
    expect(String(result.output)).toContain("KEY FACT");
    // …but worker success cannot upgrade a budget-forced harness join.
    expect(result.status).toBe("partial");
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.budgetTerminalPartial).toBe(true);
    expect(meta.harnessAuthoredOutput).toBe(true);
    expect(typeof meta.verificationWarning).toBe("string");
  });

  it("CONTROL: within budget, SOLVE runs and the run reports completed with no markers", async () => {
    const result = await runBlueprint({});
    expect(result.status).toBe("completed");
    expect(String(result.output)).toContain("FINAL REPORT");
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.budgetTerminalPartial).toBeUndefined();
    expect(meta.harnessAuthoredOutput).toBeUndefined();
  });
});
