// Smoke tests for the 2026-11-18 measurement spikes (S3 retrospective, S4 census).
import { describe, expect, it } from "bun:test";
import { type SavedCell, parseResults } from "../src/spikes/cells.js";
import { v2Evaluate } from "../src/spikes/gate-v2.js";
import { aaSplit, armStats, mcnemar } from "../src/spikes/s3-analysis.js";
import { census, requiredEffectGivenTrigger } from "../src/spikes/s4-census.js";
import { icc1, newcombeDiff, passAtK, passHatK, signFlipP } from "../src/spikes/stats.js";
import { v1Evaluate } from "../src/spikes/v1-replay.js";

const cell = (taskId: string, run: number, solved: boolean, tokens = 1000, tier = "t"): SavedCell => ({
  tier,
  taskId,
  run,
  accuracy: solved ? 1 : 0,
  solved,
  inconclusive: false,
  tokens,
  billedTokens: tokens,
  durationMs: 1,
  iterations: 3,
  status: solved ? "pass" : "fail",
  traceFile: null,
  terminatedBy: null,
});
const arm = (pass: Record<string, number>, n: number, tokens = 1000): SavedCell[] =>
  Object.entries(pass).flatMap(([t, x]) => Array.from({ length: n }, (_, i) => cell(t, i, i < x, tokens)));

describe("spike stats", () => {
  it("pass^k is C(c,k)/C(n,k); pass@k is its complement form", () => {
    expect(passHatK(5, 5, 5)).toBe(1);
    expect(passHatK(5, 4, 5)).toBe(0);
    expect(passHatK(5, 4, 2)).toBeCloseTo(0.6, 9);
    expect(passAtK(5, 1, 5)).toBe(1);
  });
  it("newcombe interval is valid at 0 and 1; ICC is high for task-driven outcomes", () => {
    const d = newcombeDiff(5, 5, 5, 5);
    expect(d.diff).toBe(0);
    expect(d.lo).toBeLessThan(0);
    expect(icc1([[1, 1, 1], [0, 0, 0], [1, 1, 1]])).toBeGreaterThan(0.9);
  });
  it("sign-flip p is 1 for a symmetric sample and small for a one-sided one", () => {
    expect(signFlipP([1, -1])).toBe(1);
    expect(signFlipP([1, 1, 1, 1, 1, 1, 1, 1])).toBeLessThan(0.02);
  });
});

describe("gate v2 spike", () => {
  it("flags a collapsed task as a veto and a plain A/A as need-more-cells", () => {
    const base = arm({ a: 5, b: 5, c: 3 }, 5);
    const harm = arm({ a: 5, b: 0, c: 3 }, 5);
    expect(v2Evaluate(base, harm).verdict).toBe("reject-veto-pending");
    expect(v2Evaluate(base, arm({ a: 5, b: 5, c: 3 }, 5)).verdict).toBe("need-more-cells");
  });
  it("v1 replay returns a decision and McNemar counts discordant pairs", () => {
    const base = arm({ a: 5, b: 3 }, 5);
    const cand = arm({ a: 5, b: 1 }, 5);
    expect(v1Evaluate(base, cand).decision).toBeDefined();
    const m = mcnemar(base, cand);
    expect(m.b).toBe(2);
    expect(m.c).toBe(0);
  });
  it("A/A split and arm stats run on synthetic cells", () => {
    const cells = arm({ a: 6, b: 3, c: 0 }, 6);
    expect(aaSplit(cells, 5, 1)?.halfRuns).toBe(3);
    expect(armStats(cells)[0]?.passHat.length).toBe(6);
  });
});

describe("S4 census", () => {
  it("counts per-cell key rates and per-task top rate", () => {
    const keyed = [
      { cell: cell("a", 0, true), keys: new Set(["k1", "k2"]) },
      { cell: cell("a", 1, true), keys: new Set(["k1"]) },
      { cell: cell("b", 0, true), keys: new Set<string>() },
    ];
    const rows = census(keyed);
    expect(rows[0]).toMatchObject({ key: "k1", cellsFired: 2, topTask: "a" });
    expect(requiredEffectGivenTrigger(3, 0.1)).toBeCloseTo(30, 9);
  });
  it("parseResults drops cells without a task and keeps provenance", () => {
    const r = parseResults(JSON.stringify({ gitSha: "x", cells: [{ taskId: "t", tier: "m", solved: true }, { tier: "m" }] }), "p");
    expect(r?.cells.length).toBe(1);
  });
});
