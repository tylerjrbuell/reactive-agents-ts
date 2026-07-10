// Run: bun test packages/benchmarks/tests/gate-paired.test.ts
//
// Instrument audit 2026-07-10, two defects in the lift gate:
//
// 1. UNPAIRED MEANS. gate.ts compared pooled arm means. If a task errored in
//    one arm only, the two arms silently compared DIFFERENT task sets — the
//    lift became an artifact of composition, not of the mechanism. The fix is
//    the paired per-task estimator (Anthropic, arXiv:2411.00640): inner-join
//    arms on taskId, d_t per task, D̄ = mean(d_t), and SE(D̄) =
//    max(within-cell, between-task clustered) — the larger of the two noise
//    sources, never the convenient one.
//
// 2. significanceK = 1 — a 68% band. A coin flip clears a 1σ bar ~1/3 of the
//    time. Promotion to default-on now demands 1.96σ (95%); the exploratory
//    read (significant / regresses flags) keeps the historical band.
//
// Plus the pass^k reliability hook (tau-bench): a candidate that lifts the
// MEAN while gutting run-to-run consistency (pass^8) must not reach
// default-on.

import { describe, expect, it } from "bun:test";
import { aggregateRuns } from "../src/runner.js";
import { evaluateLiftGate, projectTierEvidence } from "../src/gate/gate.js";
import { DEFAULT_LIFT_POLICY } from "../src/gate/types.js";
import { formatGateReceipt } from "../src/gate/receipt.js";
import type { RunScore, SessionReport, TaskVariantReport } from "../src/types.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

const run = (accuracy: number, i: number): RunScore => ({
  runIndex: i,
  dimensions: [{ dimension: "accuracy", score: accuracy, evidence: "" }],
  tokensUsed: 1000,
  durationMs: 10,
  status: "pass",
});

const bernoulli = (ones: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => (i < ones ? 1 : 0));

/** A cell built through the real producer (aggregateRuns) — seam coverage. */
const cell = (
  taskId: string,
  model: string,
  variantId: string,
  scores: readonly number[],
  meanTokens = 1000,
): TaskVariantReport => ({
  ...aggregateRuns(
    taskId,
    model,
    { type: "internal", id: variantId, label: variantId, config: {} },
    scores.map(run),
  ),
  meanTokens,
});

const report = (rows: readonly TaskVariantReport[]): SessionReport =>
  ({ taskReports: rows }) as SessionReport;

// ── 1. paired per-task differences ───────────────────────────────────────────

describe("paired per-task estimator", () => {
  it("liftPp is the MEAN OF PER-TASK DIFFS, with each d_t exposed on perTask", () => {
    const rep = report([
      cell("t1", "m", "base", bernoulli(20, 100)), // 0.20
      cell("t1", "m", "cand", bernoulli(50, 100)), // 0.50 → d = +30pp
      cell("t2", "m", "base", bernoulli(80, 100)), // 0.80
      cell("t2", "m", "cand", bernoulli(90, 100)), // 0.90 → d = +10pp
    ]);
    const ev = projectTierEvidence(rep, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.liftPp).toBeCloseTo(20, 6);
    expect(ev[0]!.baselineMetric).toBeCloseTo(0.5, 6);
    expect(ev[0]!.candidateMetric).toBeCloseTo(0.7, 6);
    const byTask = new Map(ev[0]!.perTask.map((p) => [p.taskId, p]));
    expect(byTask.get("t1")!.dPp).toBeCloseTo(30, 6);
    expect(byTask.get("t2")!.dPp).toBeCloseTo(10, 6);
    expect(byTask.get("t1")!.sePp).toBeGreaterThan(0);
    expect(ev[0]!.unpairedTaskIds).toEqual([]);
  });

  // THE mutant-killer for "revert to pooled means": pooled arms here read
  // base=(0.2+0.8)/2=0.5 vs cand=0.5 → 0pp lift. The PAIRED estimate is +30pp
  // on the only task both arms actually measured.
  it("a task present in one arm only is EXCLUDED from the estimate and REPORTED", () => {
    const rep = report([
      cell("t1", "m", "base", bernoulli(20, 100)), // 0.20
      cell("t2", "m", "base", bernoulli(80, 100)), // errored in cand arm
      cell("t1", "m", "cand", bernoulli(50, 100)), // 0.50
    ]);
    const ev = projectTierEvidence(rep, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev[0]!.liftPp).toBeCloseTo(30, 6); // NOT 0 (pooled)
    expect(ev[0]!.baselineMetric).toBeCloseTo(0.2, 6); // paired cells only
    expect(ev[0]!.candidateMetric).toBeCloseTo(0.5, 6);
    expect(ev[0]!.perTask).toHaveLength(1);
    expect(ev[0]!.unpairedTaskIds).toEqual(["t2"]);
  });

  it("disjoint task sets (zero pairs) → inconclusive, never a fabricated lift", () => {
    const rep = report([
      cell("t1", "m", "base", bernoulli(20, 100)),
      cell("t2", "m", "cand", bernoulli(90, 100)),
    ]);
    const ev = projectTierEvidence(rep, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev[0]!.inconclusive).toBe(true);
    expect(ev[0]!.passes).toBe(false);
    expect(ev[0]!.perTask).toHaveLength(0);
    expect([...ev[0]!.unpairedTaskIds].sort()).toEqual(["t1", "t2"]);
  });

  // Kills "drop the max(), keep within-cell only": two tasks whose effects
  // disagree hard (+40pp / 0pp) at n=400 have a tiny within-cell SE (~2.1pp)
  // but a between-task spread of exactly sd([40,0])/√2 = 20pp. The clustered
  // term must win.
  it("SE(D̄) takes the LARGER of within-cell and between-task terms", () => {
    const rep = report([
      cell("t1", "m", "base", bernoulli(80, 400)), // 0.2
      cell("t1", "m", "cand", bernoulli(240, 400)), // 0.6 → +40pp
      cell("t2", "m", "base", bernoulli(320, 400)), // 0.8
      cell("t2", "m", "cand", bernoulli(320, 400)), // 0.8 → 0pp
    ]);
    const ev = projectTierEvidence(rep, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev[0]!.liftPp).toBeCloseTo(20, 6);
    // Between-task: sd([40,0]) = √800 ≈ 28.28pp; /√2 = 20pp exactly.
    expect(ev[0]!.stdErrPp).toBeCloseTo(20, 6);
    // |20pp| > 1×20pp is false → a task-heterogeneous "effect" is not
    // significant no matter how many runs each cell carries.
    expect(ev[0]!.significant).toBe(false);
    expect(ev[0]!.passes).toBe(false);
  });
});

// ── 2. the promotion band: 1.96σ for default-on, 1σ exploratory ─────────────

describe("promotion significance (95%) vs exploratory (68%)", () => {
  // 6pp lift at n=200/arm: SE(diff) ≈ 4.8pp. Clears 1σ (exploratory
  // significant) but NOT 1.96σ (promotion). Two tiers so minTiers is met.
  const rep = report([
    cell("t1", "local", "base", bernoulli(120, 200)),
    cell("t1", "local", "cand", bernoulli(132, 200)),
    cell("t1", "frontier", "base", bernoulli(120, 200)),
    cell("t1", "frontier", "cand", bernoulli(132, 200)),
  ]);

  it("a 1σ-but-not-1.96σ lift stays out of default-on", () => {
    const v = evaluateLiftGate(rep, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(v.perTier[0]!.significant).toBe(true); // exploratory band (K=1)
    expect(v.perTier[0]!.passes).toBe(false); // promotion band (1.96)
    expect(v.decision).toBe("opt-in");
  });

  it("lowering promotionSignificanceK to 1 restores the exploratory behavior", () => {
    const v = evaluateLiftGate(rep, "base", "cand", {
      ...DEFAULT_LIFT_POLICY,
      promotionSignificanceK: 1,
    });
    expect(v.decision).toBe("default-on");
  });

  it("the promotion bar is exposed as promotionNoisePp = 1.96 × stdErrPp", () => {
    const ev = projectTierEvidence(rep, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev[0]!.promotionNoisePp).toBeCloseTo(ev[0]!.stdErrPp * 1.96, 9);
    expect(ev[0]!.noisePp).toBeCloseTo(ev[0]!.stdErrPp * 1, 9);
  });
});

// ── 3. pass^k reliability hook ───────────────────────────────────────────────

describe("pass^8 non-regression hook", () => {
  // Baseline: 56/64 solved → mean 0.875, pass^8 ≈ 0.321 (consistent).
  // Candidate: 24 solves + 40 runs at 0.99 → mean 0.994 (+11.9pp, promotes on
  // the mean alone) but pass^8 ≈ 0.0002 — the candidate traded run-to-run
  // consistency for partial credit. The hook must block default-on.
  const base = bernoulli(56, 64);
  const inconsistentCand = [...Array(24).fill(1), ...Array(40).fill(0.99)] as number[];
  const consistentCand = [...Array(60).fill(1), ...Array(4).fill(0.99)] as number[];

  const repWith = (cand: readonly number[]): SessionReport =>
    report([
      cell("t1", "local", "base", base),
      cell("t1", "local", "cand", cand),
      cell("t1", "frontier", "base", base),
      cell("t1", "frontier", "cand", cand),
    ]);

  it("a mean-lifting, consistency-gutting candidate is blocked", () => {
    const v = evaluateLiftGate(repWith(inconsistentCand), "base", "cand");
    const t = v.perTier[0]!;
    expect(t.passK).toBeDefined();
    expect(t.passK!.k).toBe(8);
    expect(t.passK!.baseline).toBeCloseTo(0.320936, 3);
    expect(t.passK!.candidate).toBeLessThan(0.01);
    expect(t.passK!.nonRegression).toBe(false);
    expect(t.passes).toBe(false);
    expect(v.decision).toBe("opt-in"); // NOT default-on
  });

  it("the same lift WITHOUT the consistency regression promotes", () => {
    const v = evaluateLiftGate(repWith(consistentCand), "base", "cand");
    const t = v.perTier[0]!;
    expect(t.passK!.nonRegression).toBe(true);
    expect(t.passes).toBe(true);
    expect(v.decision).toBe("default-on");
  });

  it("n < 8 → passK is ABSENT and never blocks; the receipt says underpowered", () => {
    const rep = report([
      cell("t1", "m", "base", bernoulli(2, 4)),
      cell("t1", "m", "cand", bernoulli(3, 4)),
    ]);
    const ev = projectTierEvidence(rep, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev[0]!.passK).toBeUndefined();
    const v = evaluateLiftGate(rep, "base", "cand");
    expect(formatGateReceipt(v)).toContain("passK: underpowered");
  });
});

// ── 4. receipt rendering ─────────────────────────────────────────────────────

describe("gate receipt — per-task deltas", () => {
  it("renders each paired task's delta under its tier", () => {
    const v = evaluateLiftGate(
      report([
        cell("t1", "m", "base", bernoulli(20, 100)),
        cell("t1", "m", "cand", bernoulli(50, 100)),
        cell("t2", "m", "base", bernoulli(80, 100)),
        cell("t2", "m", "cand", bernoulli(90, 100)),
      ]),
      "base",
      "cand",
    );
    const out = formatGateReceipt(v);
    expect(out).toContain("t1");
    expect(out).toContain("+30.0pp");
    expect(out).toContain("t2");
    expect(out).toContain("+10.0pp");
  });

  it("names the tasks excluded as unpaired", () => {
    const v = evaluateLiftGate(
      report([
        cell("t1", "m", "base", bernoulli(20, 100)),
        cell("t2", "m", "base", bernoulli(80, 100)),
        cell("t1", "m", "cand", bernoulli(50, 100)),
      ]),
      "base",
      "cand",
    );
    const out = formatGateReceipt(v);
    expect(out).toContain("unpaired");
    expect(out).toContain("t2");
  });
});
