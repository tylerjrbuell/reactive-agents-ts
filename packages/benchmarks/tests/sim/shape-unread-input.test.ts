// Run: bun run repo test packages/benchmarks/tests/sim/shape-unread-input.test.ts
// Shape 1: partial answer with an unread input (leanFinalTurn). Zero tokens.
import { describe, expect, it } from "bun:test";
import { armConfig, findMechanism } from "../../src/sim/mechanisms.js";
import { unreadInputAbspath, unreadInputFilename, unreadInputProse } from "../../src/sim/shapes/index.js";
import { verdictOf } from "./matrix.js";
import { runArm } from "./run-shape.js";

const LEAN = "guard:lean_final_turn:redirect";
const lean = findMechanism("leanFinalTurn")!;

describe("shape 1: unread input, leanFinalTurn", () => {
  it("prose-named inputs: the lean turn waits until both reads are made (no longer HURTS)", async () => {
    const off = await runArm(unreadInputProse, armConfig());
    const on = await runArm(unreadInputProse, armConfig(lean));
    expect(off.meetsIdeal).toBe(true);
    expect(on.meetsIdeal).toBe(true);
    expect(on.toolSeq).toEqual(["gather", "gather"]);
    expect(on.output).not.toContain("I still need");
    expect(verdictOf(off, on)).not.toBe("hurts");
  }, 30000);

  // Zoo-live 2026-11-18 B1. On the kernel at 4b3c33c64 (FILE_TOKEN rejects `/.bench-run-*/`) the lean turn
  // fires after 1 of 2 reads, the tool-less reply says "I still need to read b.json", the run ends:
  // verdict HURTS, ideal 1>0 (measured on a detached worktree of b137fde0e). It must not.
  it("absolute dot-directory paths (bench-realistic): the lean turn waits for both reads", async () => {
    const off = await runArm(unreadInputAbspath, armConfig());
    const on = await runArm(unreadInputAbspath, armConfig(lean));
    expect(off.meetsIdeal).toBe(true);
    expect(on.output).not.toContain("I still need");
    expect(on.toolSeq).toEqual(["file-read", "file-read"]);
    expect(on.meetsIdeal).toBe(true);
    expect(verdictOf(off, on)).not.toBe("hurts");
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
