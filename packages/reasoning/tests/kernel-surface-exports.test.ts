// Run: bun test packages/reasoning/tests/kernel-surface-exports.test.ts --timeout 15000
// File: tests/kernel-surface-exports.test.ts
//
// W0.4a — pins the public composable-kernel extension surface on the package
// ENTRY barrel (src/index.ts), not on deep source paths. The docs teach
// makeKernel/Phase/Guard patterns; this test proves consumers can actually
// reach them from @reactive-agents/reasoning's public surface.
//
// Scope: smoke-level construction + nameability pins ONLY. Kernel behavior
// belongs to the kernel test suite.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import * as reasoning from "../src/index.js";

describe("composable-kernel extension surface (W0.4a)", () => {
  it("exports makeKernel as a callable value", () => {
    expect(typeof reasoning.makeKernel).toBe("function");
  }, 15000);

  it("makeKernel() with no options produces a usable kernel", () => {
    const kernel = reasoning.makeKernel();
    expect(typeof kernel).toBe("function");
  }, 15000);

  it("makeKernel({ phases }) accepts a custom Phase pipeline", () => {
    // Trivial identity phase — construction check, not behavior.
    const phase: reasoning.Phase = (state) => Effect.succeed(state);
    const kernel = reasoning.makeKernel({ phases: [phase] });
    expect(typeof kernel).toBe("function");
  }, 15000);

  // Compile-time pins: prove each type-only export is nameable from the
  // public surface (fails `tsc --noEmit` if the type is missing).
  it("type-only exports are nameable from the package surface", () => {
    const phase: reasoning.Phase | null = null;
    const guard: reasoning.Guard | null = null;
    const metaToolHandler: reasoning.MetaToolHandler | null = null;
    const kernelContext: reasoning.KernelContext | null = null;
    const thoughtKernel: reasoning.ThoughtKernel | null = null;
    const kernelState: reasoning.KernelState | null = null;

    // Keep the pins referenced so no dead-code elimination complains, and
    // assert runtime-visible companions exist alongside them.
    void [phase, guard, metaToolHandler, kernelContext, thoughtKernel, kernelState];
    expect(typeof reasoning.reactKernel).toBe("function");
    expect(typeof reasoning.executeReActKernel).toBe("function");
  }, 15000);
});
