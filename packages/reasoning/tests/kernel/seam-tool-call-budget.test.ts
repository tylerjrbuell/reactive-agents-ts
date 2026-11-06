// Run: bun test packages/reasoning/tests/kernel/seam-tool-call-budget.test.ts --timeout 20000
//
// maxCallsPerTool rides RunEnvelope.rails (one carrier, no per-strategy
// forwarding). Kernel passes get it through mergeRunEnvelopeIntoKernelInput;
// 0-LLM direct dispatch (plan tool_call steps, code-action's sandbox) reserves
// against the run's ToolCallBudget. End-to-end over every strategy: conformance
// C10 (tests/strategies/strategy-conformance.test.ts).
import { describe, it, expect } from "bun:test";
import { makeToolCallBudget, unlimitedToolCallBudget } from "../../src/kernel/capabilities/decide/tool-call-budget.js";
import {
  buildRunEnvelope,
  mergeRunEnvelopeIntoKernelInput,
  withMaxCallsPerTool,
} from "../../src/kernel/envelope/run-envelope.js";

describe("ToolCallBudget", () => {
  it("admits calls up to the cap, then refuses with the kernel gate's text", () => {
    const budget = makeToolCallBudget({ add: 2 });
    expect(budget.reserve("add")).toBeUndefined();
    expect(budget.reserve("add")).toBeUndefined();
    expect(budget.reserve("add")).toBe(
      "add was not run: its per-tool call budget is used up (2 of 2 calls). Do not call add again; work with the results you already have.",
    );
    // A refused call is not counted: the text stays at 2 of 2.
    expect(budget.reserve("add")).toContain("(2 of 2 calls)");
  });

  it("never limits a tool with no cap, and no caps means the unlimited budget", () => {
    const budget = makeToolCallBudget({ add: 1 });
    for (let i = 0; i < 5; i++) expect(budget.reserve("search")).toBeUndefined();
    expect(makeToolCallBudget(undefined)).toBe(unlimitedToolCallBudget);
  });
});

describe("maxCallsPerTool on the RunEnvelope", () => {
  it("withMaxCallsPerTool folds caps onto the rails; caps already there win; absent is a no-op", () => {
    const base = buildRunEnvelope();
    expect(withMaxCallsPerTool(base, undefined)).toBe(base);
    expect(withMaxCallsPerTool(base, { add: 1 }).rails.maxCallsPerTool).toEqual({ add: 1 });
    const carried = buildRunEnvelope({ maxCallsPerTool: { add: 3 } });
    expect(withMaxCallsPerTool(carried, { add: 1 }).rails.maxCallsPerTool).toEqual({ add: 3 });
  });

  it("runKernel's merge fills KernelInput.maxCallsPerTool; an explicit pass value wins; no caps writes no key", () => {
    const envelope = buildRunEnvelope({ maxCallsPerTool: { add: 1 } });
    expect(mergeRunEnvelopeIntoKernelInput({ task: "t" }, envelope).maxCallsPerTool).toEqual({ add: 1 });
    expect(mergeRunEnvelopeIntoKernelInput({ task: "t", maxCallsPerTool: { add: 4 } }, envelope).maxCallsPerTool).toEqual({ add: 4 });
    expect("maxCallsPerTool" in mergeRunEnvelopeIntoKernelInput({ task: "t" }, buildRunEnvelope())).toBe(false);
  });
});
