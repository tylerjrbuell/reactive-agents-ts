// Run: bun run repo test packages/benchmarks/tests/sim/shape-unread-input.test.ts
// Shape 1: partial answer with an unread input (leanFinalTurn). Zero tokens.
import { describe, expect, it } from "bun:test";
import { armConfig, findMechanism } from "../../src/sim/mechanisms.js";
import { unreadInputFilename, unreadInputProse } from "../../src/sim/shapes/index.js";
import { verdictOf } from "./matrix.js";
import { runArm } from "./run-shape.js";

const LEAN = "guard:lean_final_turn:redirect";
const lean = findMechanism("leanFinalTurn")!;

describe("shape 1: unread input, leanFinalTurn", () => {
  it("prose-named inputs: the lean turn fires after one read and the partial reply ends the run (HURTS; known kernel defect)", async () => {
    const off = await runArm(unreadInputProse, armConfig());
    const on = await runArm(unreadInputProse, armConfig(lean));
    expect(off.meetsIdeal).toBe(true);
    expect(off.toolSeq).toEqual(["gather", "gather"]);
    expect(on.activityKeys).toContain(LEAN);
    expect(on.meetsIdeal).toBe(false);
    expect(on.toolSeq).toEqual(["gather"]); // second report never read
    expect(on.output).toContain("I still need the second report");
    expect(on.turns).toBeLessThan(off.turns);
    expect(verdictOf(off, on)).toBe("hurts");
  }, 30000);

  it("filename-named inputs: the gate holds the lean turn until both are read (neutral outcome, fewer input tokens)", async () => {
    const off = await runArm(unreadInputFilename, armConfig());
    const on = await runArm(unreadInputFilename, armConfig(lean));
    expect(on.activityKeys).toContain(LEAN);
    expect(on.meetsIdeal).toBe(true);
    expect(on.toolSeq).toEqual(["gather", "gather"]);
    expect(on.toollessTurns).toBe(1);
    expect(on.requestTokens).toBeLessThan(off.requestTokens); // tool schemas dropped on the lean turn
    expect(verdictOf(off, on)).toBe("neutral");
  }, 30000);
});
