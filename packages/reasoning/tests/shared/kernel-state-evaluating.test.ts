import { describe, it, expect } from "bun:test";
import { transitionState, initialKernelState } from "../../src/strategies/kernel/kernel-state.js";
import type { KernelRunOptions } from "../../src/strategies/kernel/kernel-state.js";

describe("KernelStatus evaluating", () => {
  it("transitionState accepts evaluating status", () => {
    const state = initialKernelState({
      maxIterations: 10,
      strategy: "test",
      kernelType: "react",
    });
    const next = transitionState(state, { status: "evaluating" });
    expect(next.status).toBe("evaluating");
  });
});

describe("KernelRunOptions strategySwitching", () => {
  it("accepts strategySwitching field", () => {
    const opts: KernelRunOptions = {
      maxIterations: 10,
      strategy: "reactive",
      kernelType: "react",
      strategySwitching: {
        enabled: true,
        maxSwitches: 2,
        fallbackStrategy: "plan-execute-reflect",
        availableStrategies: ["reactive", "plan-execute-reflect", "reflexion"],
      },
    };
    expect(opts.strategySwitching?.enabled).toBe(true);
    expect(opts.strategySwitching?.maxSwitches).toBe(2);
  });

  it("strategySwitching is optional", () => {
    const opts: KernelRunOptions = {
      maxIterations: 10,
      strategy: "reactive",
      kernelType: "react",
    };
    expect(opts.strategySwitching).toBeUndefined();
  });
});
