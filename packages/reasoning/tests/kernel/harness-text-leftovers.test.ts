/**
 * harness-text-leftovers.test.ts — owner rule 2026-11-10: the harness never
 * writes text into a result's output. These pin the four paths that still did:
 *
 *   1. a failed sub-kernel's result put `state.error` into `output`, so its
 *      cause read as step text (plan-execute composite steps);
 *   2. blueprint's budget stops wrote "Planned steps (not run, …)" and the
 *      "Step N (title):" join into output;
 *   3. plan-execute's last-step fallback shipped a harness-prefixed step note;
 *   4. an iteration-cap run of only shaped replies lost the specific
 *      "could not produce a valid tool call" cause.
 */
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { reActResultFromState } from "../../src/kernel/loop/react-kernel.js";
import { makeKernelState } from "../../src/testing/kernel-fixtures.js";
import { stepResultFromPass } from "../../src/strategies/plan-execute/step-executor.js";
import { executeBlueprint } from "../../src/strategies/blueprint.js";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { mockToolServiceLayer, succeedingToolLayer } from "../../src/testing/tool-service-mock.js";
import type { ReActKernelResult } from "../../src/kernel/state/kernel-state.js";

const kernelResult = (over: Partial<ReActKernelResult>): ReActKernelResult => ({
  ...reActResultFromState(makeKernelState({ status: "done", output: "x" })),
  ...over,
});

describe("1. failed sub-kernel result: cause on error, never output", () => {
  it("reActResultFromState keeps a failed state's error off output", () => {
    const r = reActResultFromState(makeKernelState({ status: "failed", error: "the step kernel broke", output: null }));
    expect(r.output).toBe("");
    expect(r.error).toBe("the step kernel broke");
  });

  it("a done state carries no error", () => {
    const r = reActResultFromState(makeKernelState({ status: "done", output: "answer" }));
    expect(r.output).toBe("answer");
    expect(r.error).toBeUndefined();
  });

  it("a failed sub-kernel marks the plan step failed with its cause, whatever the narrowed terminator", () => {
    const step = stepResultFromPass(kernelResult({ output: "", error: "the step kernel broke", terminatedBy: "max_iterations" }), 0);
    expect(step.success).toBe(false);
    expect(step.output).toBe("the step kernel broke");
  });

  it("a completed step with no text has no harness placeholder as its result", () => {
    const step = stepResultFromPass(kernelResult({ output: "", terminatedBy: "end_turn" }), 2);
    expect(step.success).toBe(true);
    expect(step.output).toBe("");
  });
});

const GATHER_SCHEMA = { name: "gather", description: "gather research data", parameters: [{ name: "q", type: "string", required: true }] };
const blueprint = (plan: unknown, turns: Parameters<typeof TestLLMServiceLayer>[0], budgetLimits: { tokenLimit: number }) =>
  Effect.runPromise(
    executeBlueprint({
      taskDescription: "Research topics A and B and summarize the findings.",
      taskType: "research",
      memoryContext: "",
      availableTools: ["gather"],
      availableToolSchemas: [GATHER_SCHEMA],
      config: defaultReasoningConfig,
      budgetLimits,
    } as never).pipe(
      Effect.provide(Layer.merge(TestLLMServiceLayer([{ json: plan }, ...turns]), succeedingToolLayer("gathered: metric rose 12%", GATHER_SCHEMA.parameters))),
      provideTestEnvelope,
    ),
  );

describe("2. blueprint budget stops write no harness text into output", () => {
  it("a budget crossed by planning ships no output; the unrun steps ride error", async () => {
    const r = await blueprint(
      { steps: [
        { title: "Gather A", instruction: "Gather data on topic A", type: "tool_call", toolName: "gather", toolArgs: { q: "a" } },
        { title: "Gather B", instruction: "Gather data on topic B", type: "tool_call", toolName: "gather", toolArgs: { q: "b" } },
      ] },
      [{ text: "FINAL REPORT: unused." }],
      { tokenLimit: 1 },
    );
    expect(r.output == null || r.output === "").toBe(true);
    // No answer is a failed run (the mint's empty-output law); the budget stop stays marked.
    expect(r.status).toBe("failed");
    expect(r.metadata["budgetTerminalPartial"]).toBe(true);
    expect(r.metadata["harnessAuthoredOutput"]).toBeUndefined();
    const err = String(r.error ?? "");
    expect(err).toContain("not run");
    expect(err).toContain("Gather A");
    expect(err).toContain("Gather B");
  });

  it("the budget-capped join ships the step results plainly, no 'Step N (title):' prefixes", async () => {
    const r = await blueprint(
      { steps: [
        { title: "Gather A", instruction: "Gather data on topic A", type: "tool_call", toolName: "gather", toolArgs: { q: "a" } },
        { title: "BETA long draft", instruction: "Draft the long-form findings section.", type: "analysis", dependsOn: ["s1"] },
        // A trailing tool step keeps BETA in the worker (a terminal analysis is left to SOLVE).
        { title: "Gather C", instruction: "Gather data on topic C", type: "tool_call", toolName: "gather", toolArgs: { q: "c" }, dependsOn: ["s2"] },
      ] },
      [{ match: "BETA", text: "L".repeat(200_000) }, { text: "FINAL REPORT: unused." }],
      { tokenLimit: 40_000 },
    );
    const out = String(r.output ?? "");
    expect(out).toContain("LLLL");
    expect(out).toContain("metric rose 12%");
    expect(out).not.toMatch(/Step \d+ \(/);
    expect(r.metadata["budgetTerminalPartial"]).toBe(true);
  });
});

describe("3. plan-execute's fallback never ships a harness step note", () => {
  it("no completed step result and no budget stop ships no output", async () => {
    const toolLayer = Layer.succeed(
      ToolService,
      ToolService.of({
        execute: () => Effect.succeed({ result: "[Tool error: upstream 500]", success: false }),
        getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: [] }),
        register: () => Effect.void,
        listTools: () => Effect.succeed([]),
        deregister: () => Effect.void,
      } as never),
    );
    const plan = JSON.stringify({ steps: [
      { title: "Read", instruction: "read the data", type: "tool_call", toolName: "bad-search", toolArgs: { query: "x" }, rationale: { why: "read", confidence: 0.9 } },
    ] });
    const r = await Effect.runPromise(provideTestEnvelope(
      executePlanExecute({
        taskDescription: "Read the data",
        taskType: "research",
        memoryContext: "",
        availableTools: ["bad-search"],
        availableToolSchemas: [{ name: "bad-search", description: "Search", parameters: [{ name: "query", type: "string", description: "Query", required: true }] }],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.merge(TestLLMServiceLayer([{ match: "planning agent", text: plan }, { text: "not a plan" }]), toolLayer))),
    ));
    const out = String(r.output ?? "");
    expect(out).not.toMatch(/\[(EXEC|REFLECT|PLAN|BUDGET|PATCH|SYNTHESIS)/);
    expect(out).toBe("");
    // The cause names the failed step, never a budget stop that did not happen.
    expect(r.status).toBe("failed");
    const err = String(r.error ?? "");
    expect(err).toContain("The plan produced no result: s1 (Read)");
    expect(err).not.toContain("budget");
  });
});

describe("4. iteration cap over only shaped replies keeps the specific cause", () => {
  it("the run's error names the unresolved tool call", async () => {
    const SHAPED = '{"name":"not_a_real_tool","parameters":{"q":"x"}}';
    const inner = TestLLMService([{ text: SHAPED }]);
    const toolLayer = mockToolServiceLayer({
      execute: () => Effect.succeed({ success: true, result: {} }),
      getTool: (name: string) => Effect.succeed({ name, description: "t", parameters: [] }),
    });
    const r = await Effect.runPromise(
      provideTestEnvelope(
        executeReactive({
          taskDescription: "find the answer",
          taskType: "simple",
          memoryContext: "",
          availableTools: ["web-search"],
          requiredTools: ["web-search"],
          availableToolSchemas: [{ name: "web-search", description: "Search the web", parameters: [{ name: "query", type: "string", description: "query", required: true }] }],
          config: {
            ...defaultReasoningConfig,
            strategies: {
              ...defaultReasoningConfig.strategies,
              reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 2 },
            },
          },
        }).pipe(Effect.provide(Layer.merge(Layer.succeed(LLMService, LLMService.of({ ...inner })), toolLayer))),
      ),
    );
    expect(r.output == null || r.output === "").toBe(true);
    expect(r.status).toBe("failed");
    const err = r.error ?? "";
    expect(err).toContain("could not produce a valid tool call");
    expect(err).not.toContain("not_a_real_tool");
  });
});
