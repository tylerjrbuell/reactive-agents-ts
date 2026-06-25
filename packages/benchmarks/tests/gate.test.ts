import { describe, expect, it } from "bun:test";
import type {
  DimensionScore,
  SessionReport,
  TaskVariantReport,
} from "../src/types.js";
import { evaluateLiftGate, projectTierEvidence } from "../src/gate/gate.js";
import { DEFAULT_LIFT_POLICY } from "../src/gate/types.js";

// ── fixture builders ─────────────────────────────────────────────
function scores(accuracy: number): DimensionScore[] {
  return [{ dimension: "accuracy", score: accuracy }];
}

function tvr(p: {
  taskId?: string;
  modelVariantId: string;
  variantId: string;
  accuracy?: number;
  meanTokens?: number;
  variance?: number;
  inconclusive?: boolean;
  noMetric?: boolean;
}): TaskVariantReport {
  return {
    taskId: p.taskId ?? "t1",
    modelVariantId: p.modelVariantId,
    variantId: p.variantId,
    variantLabel: p.variantId,
    runs: [],
    meanScores: p.noMetric ? [] : scores(p.accuracy ?? 0.5),
    variance: p.variance ?? 0,
    meanTokens: p.meanTokens ?? 1000,
    meanDurationMs: 100,
    passRate: 1,
    inconclusive: p.inconclusive
      ? {
          kind: "capability-source",
          provider: "test",
          model: "test-model",
          source: "fallback",
          recommendedNumCtx: 0,
          remedy: "test remedy",
          message: "test violation",
        }
      : undefined,
  };
}

function makeReport(taskReports: TaskVariantReport[]): SessionReport {
  return {
    generatedAt: "2026-06-24T00:00:00Z",
    runs: [],
    sessionId: "test",
    sessionVersion: "1",
    gitSha: "testsha",
    taskReports,
    reproducibility: {
      judgeModelSha: "judge-x",
      judgeCodeSha: "code-y",
      runId: "run-test",
      replayCommand: "bun run bench --session test",
    },
  };
}

describe("projectTierEvidence", () => {
  it("computes liftPp and tokenOverheadPct per model tier", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6, meanTokens: 1000 }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.665, meanTokens: 1010 }),
    ]);
    const ev = projectTierEvidence(report, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev.length).toBe(1);
    expect(ev[0]!.tier).toBe("local");
    expect(ev[0]!.liftPp).toBeCloseTo(6.5, 5);
    expect(ev[0]!.tokenOverheadPct).toBeCloseTo(1.0, 5);
    expect(ev[0]!.passes).toBe(true);
    expect(ev[0]!.regresses).toBe(false);
    expect(ev[0]!.significant).toBe(true);
  });

  it("skips a model not covered by both variants", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6 }),
      tvr({ modelVariantId: "frontier", variantId: "cand", accuracy: 0.9 }),
    ]);
    const ev = projectTierEvidence(report, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev.length).toBe(0);
  });

  it("marks a tier inconclusive when a cell is preflight-violated", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6 }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.7, inconclusive: true }),
    ]);
    const ev = projectTierEvidence(report, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev[0]!.inconclusive).toBe(true);
    expect(ev[0]!.passes).toBe(false);
  });

  it("marks a tier inconclusive when the metric is missing", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", noMetric: true }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.7 }),
    ]);
    const ev = projectTierEvidence(report, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev[0]!.inconclusive).toBe(true);
  });

  it("treats lift within the noise floor as not significant", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.60, variance: 0.10 }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.64, variance: 0.10 }),
    ]);
    // liftPp = 4.0; noise = significanceK(1) × variance(0.10) × 100 = 10pp → not significant.
    const ev = projectTierEvidence(report, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev[0]!.significant).toBe(false);
    expect(ev[0]!.passes).toBe(false);
  });

  it("flags a significant negative lift as regresses", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.9, meanTokens: 1000 }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.8, meanTokens: 1000 }),
    ]);
    const ev = projectTierEvidence(report, "base", "cand", DEFAULT_LIFT_POLICY);
    expect(ev[0]!.regresses).toBe(true);
    expect(ev[0]!.passes).toBe(false);
  });
});

describe("evaluateLiftGate", () => {
  function twoTier(
    baseAcc: number,
    candAcc: number,
    candTokens = 1000,
    variance = 0,
  ): SessionReport {
    return makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: baseAcc, meanTokens: 1000, variance }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: candAcc, meanTokens: candTokens, variance }),
      tvr({ modelVariantId: "frontier", variantId: "base", accuracy: baseAcc, meanTokens: 1000, variance }),
      tvr({ modelVariantId: "frontier", variantId: "cand", accuracy: candAcc, meanTokens: candTokens, variance }),
    ]);
  }

  it("promotes default-on on a clear two-tier win", () => {
    const v = evaluateLiftGate(twoTier(0.6, 0.66), "base", "cand");
    expect(v.decision).toBe("default-on");
    expect(v.aggregate.tiersCovered).toBe(2);
    expect(v.partial).toBe(false);
  });

  it("returns opt-in when lift is positive but below the threshold", () => {
    const v = evaluateLiftGate(twoTier(0.6, 0.615), "base", "cand"); // 1.5pp
    expect(v.decision).toBe("opt-in");
  });

  it("rejects when a tier significantly regresses", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6 }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.66 }),
      tvr({ modelVariantId: "frontier", variantId: "base", accuracy: 0.9 }),
      tvr({ modelVariantId: "frontier", variantId: "cand", accuracy: 0.8 }), // -10pp
    ]);
    const v = evaluateLiftGate(report, "base", "cand");
    expect(v.decision).toBe("reject");
  });

  it("blocks default-on when any tier is inconclusive (partial)", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6 }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.66 }),
      tvr({ modelVariantId: "frontier", variantId: "base", accuracy: 0.6 }),
      tvr({ modelVariantId: "frontier", variantId: "cand", accuracy: 0.66, inconclusive: true }),
    ]);
    const v = evaluateLiftGate(report, "base", "cand");
    expect(v.partial).toBe(true);
    expect(v.decision).toBe("opt-in");
  });

  it("returns opt-in when only one tier is covered (below minTiers)", () => {
    const report = makeReport([
      tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6 }),
      tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.66 }),
    ]);
    const v = evaluateLiftGate(report, "base", "cand");
    expect(v.decision).toBe("opt-in");
    expect(v.aggregate.tiersCovered).toBe(1);
  });

  it("returns opt-in when lift clears the threshold but token overhead exceeds the cap", () => {
    const v = evaluateLiftGate(twoTier(0.6, 0.66, 1200), "base", "cand"); // +6pp, +20% tokens
    expect(v.decision).toBe("opt-in");
  });

  it("returns opt-in when lift is real but within the noise floor", () => {
    const v = evaluateLiftGate(twoTier(0.6, 0.66, 1000, 0.10), "base", "cand"); // 6pp < 10pp noise
    expect(v.decision).toBe("opt-in");
  });
});

import { formatGateReceipt } from "../src/gate/receipt.js";

describe("formatGateReceipt", () => {
  it("renders the decision, a per-tier row, and the variant ids", () => {
    const v = evaluateLiftGate(
      makeReport([
        tvr({ modelVariantId: "local", variantId: "base", accuracy: 0.6, meanTokens: 1000 }),
        tvr({ modelVariantId: "local", variantId: "cand", accuracy: 0.66, meanTokens: 1010 }),
        tvr({ modelVariantId: "frontier", variantId: "base", accuracy: 0.6, meanTokens: 1000 }),
        tvr({ modelVariantId: "frontier", variantId: "cand", accuracy: 0.66, meanTokens: 1010 }),
      ]),
      "base",
      "cand",
    );
    const out = formatGateReceipt(v);
    expect(out).toContain("LIFT GATE");
    expect(out).toContain("DEFAULT-ON");
    expect(out).toContain("local");
    expect(out).toContain("frontier");
    expect(out).toContain("base");
    expect(out).toContain("cand");
  });
});
