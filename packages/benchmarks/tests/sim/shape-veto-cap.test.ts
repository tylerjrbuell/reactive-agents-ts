// Run: bun run repo test packages/benchmarks/tests/sim/shape-veto-cap.test.ts
// Shapes 4 and 5: correct answer vetoed as fabrication (rw-6); sequential calls hit the cap (todo-heavy). Zero tokens.
import { describe, expect, it } from "bun:test";
import { armConfig, findMechanism } from "../../src/sim/mechanisms.js";
import { fabricationVeto, iterationCap } from "../../src/sim/shapes/index.js";
import { verdictOf } from "./matrix.js";
import { runArm } from "./run-shape.js";

const hint = findMechanism("parallelToolHint")!;
const wrap = findMechanism("wrapUpReserve")!;

describe("shape 4: correct derived answer vetoed as fabrication (rw-6)", () => {
  it("the terminal fabricated-measurement veto ends the run failed with no repair turn (standing defect, kernel/verifier owner)", async () => {
    const off = await runArm(fabricationVeto, armConfig());
    expect(off.toolSeq).toEqual(["code-execute"]);
    expect(off.turns).toBe(2); // no turn left for the model to drop the figure
    expect(off.status).toBe("failed");
    expect(off.guardReasons.join("\n")).toContain("output-not-fabricated-measurement");
    expect(off.meetsIdeal).toBe(false); // flips true when the veto grants a repair turn
  }, 30000);

  it("no swept mechanism repairs it: wrapUpReserve is inert", async () => {
    const off = await runArm(fabricationVeto, armConfig());
    const on = await runArm(fabricationVeto, armConfig(wrap));
    expect(verdictOf(off, on)).toBe("inert");
  }, 30000);
});

describe("shape 5: sequential independent calls hit the iteration cap (todo-heavy)", () => {
  it("off: one call per turn exhausts the cap with the work unfinished", async () => {
    const off = await runArm(iterationCap, armConfig());
    expect(off.terminatedBy).toBe("max_iterations");
    expect(off.status).toBe("failed");
    expect(off.turns).toBe(10);
    expect(off.toolSeq.length).toBeLessThan(12);
  }, 30000);

  it("parallelToolHint with a model that follows it: 3 turns, all 12 calls, completed (HELPS, fewer tokens)", async () => {
    const off = await runArm(iterationCap, armConfig());
    const on = await runArm(iterationCap, armConfig(hint));
    expect(on.activityKeys).toContain("signal:nudge@parallel-tool-hint");
    expect(on.meetsIdeal).toBe(true);
    expect(on.turns).toBe(3);
    expect(on.requestTokens).toBeLessThan(off.requestTokens);
    expect(verdictOf(off, on)).toBe("helps");
  }, 30000);

  it("a model that ignores the hint (compliance 0): the hint only costs tokens", async () => {
    const off = await runArm(iterationCap, armConfig(), { compliance: 0 });
    const on = await runArm(iterationCap, armConfig(hint), { compliance: 0 });
    expect(on.meetsIdeal).toBe(false);
    expect(on.turns).toBe(off.turns);
    expect(on.requestTokens).toBeGreaterThan(off.requestTokens);
    expect(verdictOf(off, on)).toBe("neutral");
  }, 30000);
});
