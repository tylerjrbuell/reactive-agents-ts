// Run: bun test packages/runtime/tests/required-tools-boundary-success.test.ts --timeout 20000
//
// A kernel `completed`/tolerated-`partial` status with a delivered answer
// cannot outvote the result-boundary verifier's `agent-took-action` reject:
// requiredTools declared + no non-meta tool ever succeeded => success:false
// (llama3.2:3b required-tools arm shipped ok:true with that verdict).
import { describe, it, expect } from "bun:test";
import { deriveExecutionSuccess } from "../src/engine/execute-success-invariants.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../src/types.js";

const run = (toolCallLog: { toolName: string; success: boolean }[], required = ["web-search"]) => {
  const ctx = { metadata: {} } as never as ExecutionContext;
  const out = deriveExecutionSuccess({
    ctx,
    task: { id: "t", input: { question: "hi" } } as never,
    config: { requiredTools: { tools: required } } as never as ReactiveAgentsConfig,
    rr: { status: "completed", metadata: { terminatedBy: "end_turn" } } as never,
    hasSubstantiveOutput: true,
    outputForSuccess: "The answer is 180.",
    toolCallLog,
  });
  return { out, ctx };
};

describe("required-tools boundary success veto", () => {
  it("completed + no tool ever succeeded => not success, flagged", () => {
    const { out, ctx } = run([{ toolName: "web-search", success: false }]);
    expect(out.executionSucceeded).toBe(false);
    expect(ctx.metadata.requiredToolUnmetNotSuccess).toBe(true);
  });
  it("only meta tools succeeded => not success", () => {
    expect(run([{ toolName: "final-answer", success: true }]).out.executionSucceeded).toBe(false);
  });
  it("a data tool succeeded => success unchanged", () => {
    expect(run([{ toolName: "web-search", success: true }]).out.executionSucceeded).toBe(true);
  });
  it("no requiredTools declared => success unchanged", () => {
    expect(run([], []).out.executionSucceeded).toBe(true);
  });
});
