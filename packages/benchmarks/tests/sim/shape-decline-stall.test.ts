// Run: bun run repo test packages/benchmarks/tests/sim/shape-decline-stall.test.ts
// Shapes 2 and 3: honest decline after a failing tool (ab-trap-5); no-call stall (rw-7). Zero tokens.
import { describe, expect, it } from "bun:test";
import { armConfig, findMechanism } from "../../src/sim/mechanisms.js";
import { honestDecline, noCallStall } from "../../src/sim/shapes/index.js";
import { verdictOf } from "./matrix.js";
import { runArm } from "./run-shape.js";

const act = findMechanism("actOrAnswer")!;
const proactive = findMechanism("actOrAnswerProactive")!;

describe("shape 2: honest decline after an always-failing required tool (ab-trap-5)", () => {
  it("with kernel commit a93c6dd46 the run ends ABSTAINED carrying the model's own text", async () => {
    const off = await runArm(honestDecline, armConfig());
    expect(off.terminatedBy).toBe("abstained");
    expect(off.status).toBe("abstained");
    expect(off.output).toContain("cannot determine the total");
    expect(off.toolSeq).toEqual(["file-read", "file-read", "file-read"]);
    expect(off.meetsIdeal).toBe(true);
  }, 30000);

  it("actOrAnswer (both modes) does not force another read after the decline: abstention kept, no extra turns", async () => {
    const off = await runArm(honestDecline, armConfig());
    for (const m of [act, proactive]) {
      const on = await runArm(honestDecline, armConfig(m));
      // proactive still forces the early reads (nothing declined yet); none follows the decline
      expect(on.toolSeq).toEqual(off.toolSeq);
      expect(on.status).toBe("abstained");
      expect(on.turns).toBeLessThanOrEqual(off.turns);
      expect(verdictOf(off, on)).not.toBe("hurts");
    }
  }, 30000);
});

describe("shape 3: no-call stall x4 (rw-7)", () => {
  it("off: four prose turns and the run ends abstained with no tool called", async () => {
    const off = await runArm(noCallStall, armConfig());
    expect(off.toolSeq).toEqual([]);
    expect(off.status).toBe("abstained");
    expect(off.turns).toBe(4);
    expect(off.meetsIdeal).toBe(false);
  }, 30000);

  it("actOrAnswer: the forced retry gets the call and the run completes (HELPS); proactive saves a turn", async () => {
    const off = await runArm(noCallStall, armConfig());
    const on = await runArm(noCallStall, armConfig(act));
    const pro = await runArm(noCallStall, armConfig(proactive));
    expect(on.activityKeys).toContain("guard:act-or-answer:redirect");
    expect(on.toolSeq).toEqual(["file-read", "file-write"]);
    expect(on.meetsIdeal).toBe(true);
    expect(verdictOf(off, on)).toBe("helps");
    expect(pro.meetsIdeal).toBe(true);
    expect(pro.turns).toBeLessThan(on.turns);
  }, 30000);

  it("a model that ignores the forced call (compliance 0) gets no benefit", async () => {
    const on = await runArm(noCallStall, armConfig(act), { compliance: 0 });
    expect(on.toolSeq).toEqual([]);
    expect(on.meetsIdeal).toBe(false);
  }, 30000);
});
