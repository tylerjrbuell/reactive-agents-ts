/**
 * horizon-plumbing.test.ts — A2 config-plumbing + default-identity proof.
 *
 * The critical guarantee: WITHOUT `horizonProfile`, every guard sees exactly
 * today's absolute constants. This pins the two plumbing seams that carry the
 * profile from config → state.meta → the state-only guard consumers:
 *
 *   1. initialKernelState mirrors horizonProfile into state.meta (and leaves it
 *      absent by default).
 *   2. arbitrationContextFromState emits the veto window + redirect budget ONLY
 *      when the profile is present; absent by default (run-cumulative veto +
 *      one-shot redirect = today's behavior).
 */
import { describe, expect, it } from "bun:test";
import {
  initialKernelState,
  type KernelRunOptions,
} from "../../state/kernel-state.js";
import { arbitrationContextFromState } from "../../capabilities/decide/arbitrator.js";

const baseOpts = (over: Partial<KernelRunOptions>): KernelRunOptions => ({
  maxIterations: 50,
  strategy: "reactive",
  kernelType: "react",
  ...over,
});

describe("initialKernelState — horizonProfile meta mirror", () => {
  it("OFF by default: state.meta carries no horizonProfile", () => {
    const s = initialKernelState(baseOpts({}));
    expect(s.meta.horizonProfile).toBeUndefined();
    // maxIterations still mirrored exactly as before (unchanged).
    expect(s.meta.maxIterations).toBe(50);
  });

  it("ON: horizonProfile mirrored into state.meta", () => {
    const s = initialKernelState(baseOpts({ horizonProfile: "long" }));
    expect(s.meta.horizonProfile).toBe("long");
  });
});

describe("arbitrationContextFromState — default byte-identity", () => {
  it("OFF by default: no veto window, no redirect budget (today's behavior)", () => {
    const s = initialKernelState(baseOpts({}));
    const ctx = arbitrationContextFromState(s, { task: "t", requiredTools: [] });
    expect(ctx.vetoDecisionWindow).toBeUndefined();
    expect(ctx.redirectBudget).toBeUndefined();
  });

  it("ON (maxIterations 50): veto window 10 + redirect budget 2", () => {
    const s = initialKernelState(baseOpts({ horizonProfile: "long" }));
    const ctx = arbitrationContextFromState(s, { task: "t", requiredTools: [] });
    expect(ctx.vetoDecisionWindow).toBe(10);
    expect(ctx.redirectBudget).toBe(2);
  });

  it("ON (maxIterations 20): veto window 10 + redirect budget stays 1 (sub-30)", () => {
    const s = initialKernelState(baseOpts({ horizonProfile: "long", maxIterations: 20 }));
    const ctx = arbitrationContextFromState(s, { task: "t", requiredTools: [] });
    expect(ctx.vetoDecisionWindow).toBe(10);
    expect(ctx.redirectBudget).toBe(1);
  });
});
