// Run: bun test packages/benchmarks/tests/gate-token-free-tier.test.ts
//
// Owner ruling 2026-11-06: tokens on local models are free, so on a tier the
// caller marks token-free the cost leg is reported but never blocks a pass.

import { describe, expect, it } from "bun:test";
import type {
  DimensionScore,
  SessionReport,
  TaskVariantReport,
} from "../src/types.js";
import { evaluateLiftGate, projectTierEvidence } from "../src/gate/gate.js";
import { DEFAULT_LIFT_POLICY } from "../src/gate/types.js";

// ── fixture builders (copied from gate-billed-token-leg.test.ts) ─
function scores(accuracy: number): DimensionScore[] {
  return [{ dimension: "accuracy", score: accuracy }];
}

function runsOf(accuracy: number, n: number) {
  const ones = Math.round(accuracy * n);
  return Array.from({ length: n }, (_, i) => ({
    runIndex: i,
    dimensions: [{ dimension: "accuracy", score: i < ones ? 1 : 0 }],
    tokensUsed: 1000,
    durationMs: 10,
    status: "success" as const,
  }));
}

function tvr(p: {
  taskId?: string;
  modelVariantId: string;
  variantId: string;
  accuracy?: number;
  meanTokens?: number;
  meanBilledTokens?: number;
  meanCacheReadTokens?: number;
  variance?: number;
  n?: number;
  inconclusive?: boolean;
  noMetric?: boolean;
}): TaskVariantReport {
  const accuracy = p.accuracy ?? 0.5;
  const meanTokens = p.meanTokens ?? 1000;
  return {
    taskId: p.taskId ?? "t1",
    modelVariantId: p.modelVariantId,
    variantId: p.variantId,
    variantLabel: p.variantId,
    runs: runsOf(accuracy, p.n ?? 1000) as TaskVariantReport["runs"],
    meanScores: p.noMetric ? [] : scores(accuracy),
    variance: p.variance ?? 0,
    meanTokens,
    meanBilledTokens: p.meanBilledTokens ?? meanTokens,
    meanCacheReadTokens: p.meanCacheReadTokens ?? 0,
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

// A local-tier arm: +10pp accuracy at +40% billed tokens (the act-or-answer
// shape on cogito:8b, 2026-11-06). Paid rule rejects it on cost.
const expensiveArm = () =>
  makeReport([
    tvr({ modelVariantId: "cogito:8b", variantId: "base", accuracy: 0.5, meanTokens: 10_000 }),
    tvr({ modelVariantId: "cogito:8b", variantId: "cand", accuracy: 0.6, meanTokens: 14_000 }),
  ]);

describe("token-free tiers (owner ruling 2026-11-06)", () => {
  it("a paid tier still fails on token overhead", () => {
    const [evidence] = projectTierEvidence(expensiveArm(), "base", "cand", DEFAULT_LIFT_POLICY);
    expect(evidence?.passes).toBe(false);
    expect(evidence?.tokenFree).toBeUndefined();
  });

  it("a token-free tier passes on accuracy and still reports the overhead", () => {
    const [evidence] = projectTierEvidence(expensiveArm(), "base", "cand", DEFAULT_LIFT_POLICY, {
      isTokenFreeTier: (tier) => tier === "cogito:8b",
    });
    expect(evidence?.passes).toBe(true);
    expect(evidence?.tokenFree).toBe(true);
    expect(evidence?.billedTokenOverheadPct).toBeCloseTo(40, 5);
  });

  it("the predicate applies per tier", () => {
    const [evidence] = projectTierEvidence(expensiveArm(), "base", "cand", DEFAULT_LIFT_POLICY, {
      isTokenFreeTier: (tier) => tier === "haiku",
    });
    expect(evidence?.passes).toBe(false);
  });
});
