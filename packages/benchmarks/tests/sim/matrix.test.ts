// Run: bun run repo test packages/benchmarks/tests/sim/matrix.test.ts
// Phase Z matrix: verdict rules, sign test, sweep classification, real flag names. Zero tokens.
import { describe, expect, it } from "bun:test";
import { buildRunEnvelope } from "@reactive-agents/reasoning";
import { ALL_OFF, MECHANISMS, armConfig } from "../../src/sim/mechanisms.js";
import { SHAPES, iterationCap, unreadInputProse } from "../../src/sim/shapes/index.js";
import { classifySweep, formatMatrix, matrix, runCell, signTestP, verdictOf } from "./matrix.js";
import type { ArmResult } from "./run-shape.js";

const arm = (over: Partial<ArmResult>): ArmResult => ({
  meetsIdeal: true,
  distance: 0,
  terminatedBy: "end_turn",
  status: "completed",
  turns: 3,
  requestTokens: 100,
  activityKeys: [],
  toolSeq: [],
  guardReasons: [],
  output: "",
  toollessTurns: 0,
  trace: "t",
  ...over,
});

describe("verdictOf", () => {
  it("identical request log is inert, whatever else is equal", () => {
    expect(verdictOf(arm({}), arm({}))).toBe("inert");
  });
  it("fewer missed ideal components helps; more hurts; equal but different is neutral", () => {
    expect(verdictOf(arm({ distance: 2, meetsIdeal: false }), arm({ trace: "u" }))).toBe("helps");
    expect(verdictOf(arm({}), arm({ distance: 1, meetsIdeal: false, trace: "u" }))).toBe("hurts");
    expect(verdictOf(arm({}), arm({ requestTokens: 90, trace: "u" }))).toBe("neutral");
  });
});

describe("signTestP", () => {
  it("is exact and two-sided", () => {
    expect(signTestP(0, 0)).toBe(1);
    expect(signTestP(1, 0)).toBe(1);
    expect(signTestP(5, 0)).toBeCloseTo(2 / 32, 10);
    expect(signTestP(0, 28)).toBeLessThan(0.001);
    expect(signTestP(3, 3)).toBe(1);
  });
});

describe("classifySweep", () => {
  const at = (...v: ("helps" | "hurts" | "neutral" | "inert")[]) => v.map((verdict, i) => ({ compliance: i / 4, verdict }));
  it("names the flip point from harmful to helpful", () => {
    expect(classifySweep(at("hurts", "hurts", "neutral", "helps", "helps"))).toEqual({ pattern: "flips-to-helpful", flipAt: 0.75 });
  });
  it("harmful everywhere, never harmful, inert, mixed", () => {
    expect(classifySweep(at("hurts", "hurts", "hurts")).pattern).toBe("harmful-everywhere");
    expect(classifySweep(at("neutral", "helps", "helps")).pattern).toBe("never-harmful");
    expect(classifySweep(at("inert", "inert")).pattern).toBe("inert");
    expect(classifySweep(at("helps", "hurts", "neutral")).pattern).toBe("mixed");
  });
});

describe("mechanisms", () => {
  it("every mechanism's flag is a real HarnessConfig field the resolver honours (off arm pinned off)", () => {
    const off = buildRunEnvelope({ harness: armConfig() }).harness;
    for (const m of MECHANISMS) {
      const on = buildRunEnvelope({ harness: armConfig(m) }).harness;
      expect(JSON.stringify(on)).not.toBe(JSON.stringify(off));
    }
    expect(Object.keys(ALL_OFF).sort()).toEqual(
      [...new Set(MECHANISMS.flatMap((m) => Object.keys(m.on)))].sort(),
    );
  });
});

describe("matrix", () => {
  it("every shape names its source evidence; ids are unique", () => {
    expect(new Set(SHAPES.map((s) => s.id)).size).toBe(SHAPES.length);
    for (const s of SHAPES) expect(s.sourceTraceId.length).toBeGreaterThan(10);
  });

  it("a deterministic cell carries verdict, deltas and win/loss", async () => {
    const lean = MECHANISMS.find((m) => m.name === "leanFinalTurn")!;
    const cell = await runCell(unreadInputProse, lean, {});
    expect(cell.verdict).toBe("hurts");
    expect(cell.losses).toBe(1);
    expect(cell.turnsDelta).toBe(-1);
    expect(cell.tokensDelta).toBeLessThan(0);
    expect(cell.offMeets).toBe(1);
    expect(cell.onMeets).toBe(0);
  }, 30000);

  it("matrix() is shape-major and formats one row per cell", async () => {
    const hint = MECHANISMS.find((m) => m.name === "parallelToolHint")!;
    const cells = await matrix({ shapes: [unreadInputProse, iterationCap], mechanisms: [hint] });
    expect(cells.map((c) => c.verdict)).toEqual(["inert", "helps"]);
    expect(formatMatrix(cells).split("\n")).toHaveLength(3);
  }, 30000);
});
