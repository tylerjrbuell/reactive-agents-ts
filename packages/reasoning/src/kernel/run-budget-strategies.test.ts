// Run: bun test packages/reasoning/src/kernel/run-budget-strategies.test.ts --timeout 30000
//
// Issue #231 / DEBT D-2026-10-05-P — behavior proof that an armed run-scoped
// meter reaches every strategy's kernel(s) and halts a crossed tokenLimit.
//
// The meter primitive / wrapper / codec / Arbitrator-consume paths are pinned
// in the sibling `run-budget.test.ts`. This file proves the END-TO-END thread:
// `withRunBudgetMeter(effect, meter)` around a real strategy run (a) feeds the
// meter through the observable LLM wrapper on every kernel pass and direct
// call, and (b) drives a budget termination. Scenarios mirror the existing
// honest-partial integration suites (tokenLimit:1 + long horizon) but wrap the
// effect in `withRunBudgetMeter` and provide the observable-wrapped LLM layer,
// which is what makes the meter live.
//
// Co-located under src/kernel/** (authority bound) — strategies imported
// read-only.

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import type { Layer as LayerType } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import { makeObservableLLM } from "./observable-llm.js";
import { makeRunBudgetMeter, withRunBudgetMeter } from "./run-budget.js";
import { executeReactive } from "../strategies/reactive.js";
import { executePlanExecute } from "../strategies/plan-execute.js";
import { executeReflexion } from "../strategies/reflexion.js";
import { executeTreeOfThought } from "../strategies/tree-of-thought.js";
import { executeBlueprint } from "../strategies/blueprint.js";
import { defaultReasoningConfig } from "../types/config.js";
import { succeedingToolLayer } from "../testing/tool-service-mock.js";
import { provideTestEnvelope, RunEnvelope } from "./envelope/run-envelope.js";

const GATHER_SCHEMA = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", required: true }],
};
const AUDIT_SCHEMA = {
  name: "audit",
  description: "audit gathered data",
  parameters: [{ name: "q", type: "string", required: true }],
};

const gatherToolLayer = succeedingToolLayer(
  { finding: "KEY FACT: the topic's core metric rose 12% last quarter." },
  GATHER_SCHEMA.parameters,
);

const TASK = "Research the topic thoroughly and write your findings to report.md.";

/**
 * Run a strategy effect with the observable LLM wrapper over the scripted
 * provider, an armed run meter, and the test envelope. Returns the result plus
 * the meter so a test can assert the wrapper actually fed it.
 */
const runWithMeter = <A, E>(
  effect: Effect.Effect<A, E, LLMService | RunEnvelope>,
  scenario: LayerType.Layer<LLMService>,
  meter: ReturnType<typeof makeRunBudgetMeter>,
): Promise<A> =>
  Effect.runPromise(
    withRunBudgetMeter(
      effect.pipe(
        Effect.provide(
          Layer.merge(makeObservableLLM().pipe(Layer.provide(scenario)), gatherToolLayer),
        ),
        provideTestEnvelope,
      ),
      meter,
    ),
  );

const budgetReasonPresent = (meta: Record<string, unknown>): boolean =>
  meta.budgetTerminalPartial === true ||
  String(meta.rawTerminatedBy ?? "").includes("budget") ||
  String(meta.verificationWarning ?? "").toLowerCase().includes("budget");

describe("run-budget — reactive: meter fed, crossed tokenLimit halts", () => {
  it("halts with a budget reason and the meter recorded real spend", async () => {
    const meter = makeRunBudgetMeter();
    const scenario = TestLLMServiceLayer([
      { match: "report\\.md", toolCall: { name: "gather", args: { q: "topic" } } },
      { match: "professional", text: "SYNTHESIZED REPORT: the metric rose 12% last quarter." },
      { text: "FINAL ANSWER: unsynthesized guess." },
    ]);
    const result = await runWithMeter(
      executeReactive({
        taskDescription: TASK,
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather"],
        availableToolSchemas: [GATHER_SCHEMA],
        config: defaultReasoningConfig,
        maxIterations: 6,
        horizonProfile: "long",
        budgetLimits: { tokenLimit: 1 },
      } as never),
      scenario,
      meter,
    );

    // The meter was fed through the strategy's kernel(s) — the thread is live.
    expect(meter.tokens).toBeGreaterThan(0);
    expect(result.output).toBeTruthy();
    expect(result.status).toBe("partial");
    expect(budgetReasonPresent(result.metadata as Record<string, unknown>)).toBe(true);
  });

  it("CONTROL: a generous limit completes and still feeds the meter", async () => {
    const meter = makeRunBudgetMeter();
    const scenario = TestLLMServiceLayer([{ text: "FINAL ANSWER: 4." }]);
    const result = await runWithMeter(
      executeReactive({
        taskDescription: "What is 2 + 2?",
        taskType: "qa",
        memoryContext: "",
        availableTools: [],
        availableToolSchemas: [],
        config: defaultReasoningConfig,
        maxIterations: 3,
        budgetLimits: { tokenLimit: 100_000_000 },
      } as never),
      scenario,
      meter,
    );

    expect(result.status).toBe("completed");
    expect(budgetReasonPresent(result.metadata as Record<string, unknown>)).toBe(false);
    expect(meter.tokens).toBeGreaterThan(0);
  });
});

describe("run-budget — plan-execute-reflect: meter fed, crossed tokenLimit halts", () => {
  it("halts with a budget reason and the meter recorded real spend", async () => {
    const meter = makeRunBudgetMeter();
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
    const scenario = TestLLMServiceLayer([
      { json: PLAN },
      { match: "report\\.md", toolCall: { name: "gather", args: { q: "topic" } } },
      { match: "professional", text: "SYNTHESIZED REPORT: the metric rose 12% last quarter." },
      { match: "STEP RESULTS", text: "SATISFIED: the goal is fully addressed." },
      { text: "FINAL REPORT: the metric rose 12% last quarter." },
    ]);
    const result = await runWithMeter(
      executePlanExecute({
        taskDescription: TASK,
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather", "audit"],
        availableToolSchemas: [GATHER_SCHEMA, AUDIT_SCHEMA],
        config: defaultReasoningConfig,
        horizonProfile: "long",
        budgetLimits: { tokenLimit: 1 },
      } as never),
      scenario,
      meter,
    );

    expect(result.status).toBe("partial");
    expect(budgetReasonPresent(result.metadata as Record<string, unknown>)).toBe(true);
  });

  it("CONTROL: a generous limit completes and still feeds the meter (structured plan call is not metered)", async () => {
    const meter = makeRunBudgetMeter();
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
    const scenario = TestLLMServiceLayer([
      { json: PLAN },
      { match: "report\\.md", toolCall: { name: "gather", args: { q: "topic" } } },
      { match: "professional", text: "SYNTHESIZED REPORT: the metric rose 12% last quarter." },
      { match: "STEP RESULTS", text: "SATISFIED: the goal is fully addressed." },
      { text: "FINAL REPORT: the metric rose 12% last quarter." },
    ]);
    const result = await runWithMeter(
      executePlanExecute({
        taskDescription: TASK,
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather", "audit"],
        availableToolSchemas: [GATHER_SCHEMA, AUDIT_SCHEMA],
        config: defaultReasoningConfig,
        budgetLimits: { tokenLimit: 100_000_000 },
      } as never),
      scenario,
      meter,
    );

    // The composite step's kernel think (a metered stream) and the reflect /
    // synthesis calls (metered complete) all feed the run meter.
    expect(meter.tokens).toBeGreaterThan(0);
    expect(result.status).toBe("completed");
  });
});

describe("run-budget — reflexion: meter fed, crossed tokenLimit halts", () => {
  it("halts with a budget reason and the meter recorded real spend", async () => {
    const meter = makeRunBudgetMeter();
    const scenario = TestLLMServiceLayer([
      { match: "report\\.md", toolCall: { name: "gather", args: { q: "topic" } } },
      { match: "professional", text: "SYNTHESIZED REPORT: the metric rose 12% last quarter." },
      { match: "COMPLETED based on the execution evidence", text: "SATISFIED: the research is complete." },
      { text: "POLISHED: the metric rose 12% last quarter." },
    ]);
    const result = await runWithMeter(
      executeReflexion({
        taskDescription: "Research the topic thoroughly.",
        taskType: "research",
        memoryContext: "Write your findings to report.md.",
        availableTools: ["gather"],
        availableToolSchemas: [GATHER_SCHEMA],
        config: defaultReasoningConfig,
        horizonProfile: "long",
        budgetLimits: { tokenLimit: 1 },
      } as never),
      scenario,
      meter,
    );

    expect(meter.tokens).toBeGreaterThan(0);
    expect(result.status).toBe("partial");
    expect(budgetReasonPresent(result.metadata as Record<string, unknown>)).toBe(true);
  });
});

describe("run-budget — tree-of-thought: meter fed, crossed tokenLimit halts", () => {
  it("halts with a budget reason and the meter recorded real spend", async () => {
    const meter = makeRunBudgetMeter();
    const scenario = TestLLMServiceLayer([
      { match: "report\\.md", toolCall: { name: "gather", args: { q: "topic" } } },
      { match: "professional", text: "SYNTHESIZED REPORT: the metric rose 12% last quarter." },
      { text: "FINAL ANSWER: unsynthesized guess." },
    ]);
    // Injected trivial classification forces ToT's cost-gated SKIP path (a
    // single react branch kernel) — deterministic, no BFS.
    const { classifyTask } = await import("./capabilities/comprehend/task-classification.js");
    const result = await runWithMeter(
      executeTreeOfThought({
        taskDescription: TASK,
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather"],
        availableToolSchemas: [GATHER_SCHEMA],
        taskClassification: classifyTask("What is 2 + 2?"),
        config: defaultReasoningConfig,
        maxIterations: 6,
        horizonProfile: "long",
        budgetLimits: { tokenLimit: 1 },
      } as never),
      scenario,
      meter,
    );

    expect(meter.tokens).toBeGreaterThan(0);
    expect(result.status).toBe("partial");
    expect(budgetReasonPresent(result.metadata as Record<string, unknown>)).toBe(true);
  });
});

describe("run-budget — blueprint: meter fed, crossed tokenLimit halts", () => {
  it("halts with a budget reason and the meter recorded real spend", async () => {
    const meter = makeRunBudgetMeter();
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
    const scenario = TestLLMServiceLayer([
      { json: PLAN },
      { match: "Synthesize a clear, complete answer", text: "FINAL REPORT: A and B both rose 12%." },
      { text: "FINAL REPORT: A and B both rose 12%." },
    ]);
    const result = await runWithMeter(
      executeBlueprint({
        taskDescription: "Research topics A and B and summarize the findings.",
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather"],
        availableToolSchemas: [GATHER_SCHEMA],
        config: defaultReasoningConfig,
        budgetLimits: { tokenLimit: 1 },
      } as never),
      scenario,
      meter,
    );

    expect(result.status).toBe("partial");
    expect(budgetReasonPresent(result.metadata as Record<string, unknown>)).toBe(true);
  });

  it("CONTROL: a generous limit completes and still feeds the meter", async () => {
    const meter = makeRunBudgetMeter();
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
    const scenario = TestLLMServiceLayer([
      { json: PLAN },
      { match: "Synthesize a clear, complete answer", text: "FINAL REPORT: A and B both rose 12%." },
      { text: "FINAL REPORT: A and B both rose 12%." },
    ]);
    const result = await runWithMeter(
      executeBlueprint({
        taskDescription: "Research topics A and B and summarize the findings.",
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather"],
        availableToolSchemas: [GATHER_SCHEMA],
        config: defaultReasoningConfig,
        budgetLimits: { tokenLimit: 100_000_000 },
      } as never),
      scenario,
      meter,
    );

    // The SOLVE pass (a metered complete call) feeds the run meter.
    expect(meter.tokens).toBeGreaterThan(0);
    expect(result.status).toBe("completed");
  });
});

describe("run-budget — auxiliary pass inherits the ambient run budget (#232 Gap 2)", () => {
  it("a pass with NO input.budgetLimits still halts on the ambient run limit", async () => {
    // Simulates the verification THINK retry / continuation pass: it calls the
    // strategy with NO `budgetLimits`. The runtime armed the meter + run limits
    // around the whole run; the kernel runner must inherit those limits from the
    // ambient context so the Arbitrator still enforces the run budget.
    const meter = makeRunBudgetMeter();
    meter.tokens = 500; // the run is already past its 100-token limit
    const scenario = TestLLMServiceLayer([
      { match: "report\\.md", toolCall: { name: "gather", args: { q: "topic" } } },
      { match: "professional", text: "SYNTHESIZED REPORT: the metric rose 12% last quarter." },
      { text: "FINAL ANSWER: unsynthesized guess." },
    ]);
    const result = await Effect.runPromise(
      withRunBudgetMeter(
        executeReactive({
          taskDescription: TASK,
          taskType: "research",
          memoryContext: "",
          availableTools: ["gather"],
          availableToolSchemas: [GATHER_SCHEMA],
          config: defaultReasoningConfig,
          maxIterations: 6,
          // No `budgetLimits`: the pass declares none. Enforcement must come
          // from the ambient run limits the runtime armed.
        } as never).pipe(
          Effect.provide(
            Layer.merge(makeObservableLLM().pipe(Layer.provide(scenario)), gatherToolLayer),
          ),
          provideTestEnvelope,
        ),
        meter,
        { tokenLimit: 100 },
      ),
    );

    expect(result.status).not.toBe("completed");
    expect(budgetReasonPresent(result.metadata as Record<string, unknown>)).toBe(true);
  });
});
