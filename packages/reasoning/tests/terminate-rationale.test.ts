import { describe, it, expect } from "bun:test";
import { initialKernelState } from "../src/kernel/state/kernel-state.js";
import { terminate } from "../src/kernel/loop/terminate.js";
import type { Rationale } from "@reactive-agents/core";

describe("terminate() rationale support (v0.11.x)", () => {
  const baseInput = {
    task: "test",
    availableTools: [],
    availableToolSchemas: [],
  } as never;
  const baseCtx = {} as never;
  const baseState = initialKernelState(baseInput, baseCtx);

  it("omits terminationRationale from state.meta when no rationale provided", () => {
    const next = terminate(baseState, { reason: "max_iterations", output: "" });
    expect(next.meta.terminatedBy).toBe("max_iterations");
    expect(next.meta.terminationRationale).toBeUndefined();
  });

  it("attaches rationale to state.meta when provided", () => {
    const rationale: Rationale = { why: "quality 0.92 ≥ threshold 0.90" };
    const next = terminate(baseState, {
      reason: "quality_threshold",
      output: "final",
      rationale,
    });
    expect(next.meta.terminationRationale?.why).toMatch(/quality.*0\.92.*threshold/);
  });

  it("preserves rationale alongside extraMeta", () => {
    const next = terminate(baseState, {
      reason: "harness_deliverable",
      output: "x",
      rationale: { why: "post-loop promote", confidence: 0.7 },
      extraMeta: { previousTerminatedBy: "max_iterations" },
    });
    expect(next.meta.terminatedBy).toBe("harness_deliverable");
    expect(next.meta.previousTerminatedBy).toBe("max_iterations");
    expect(next.meta.terminationRationale?.confidence).toBe(0.7);
  });

  it("sets status: done", () => {
    const next = terminate(baseState, {
      reason: "max_iterations",
      output: "",
      rationale: { why: "iteration cap reached" },
    });
    expect(next.status).toBe("done");
  });
});
