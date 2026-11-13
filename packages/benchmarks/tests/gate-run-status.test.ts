// Run: bun run repo test packages/benchmarks/tests/gate-run-status.test.ts
//
// The accuracy-only gate cannot see a run that answers correctly and is then
// ended as `failure` (795a51884: 12/12 H3 runs status=failure at accuracy 1.00,
// gate said UNDERPOWERED). The status guard reads `RunScore.endStatus`
// (run-completed.status) and rejects on a non-success-rate jump.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { SessionReport, TaskVariantReport } from "../src/types.js";
import { evaluateLiftGate, projectTierEvidence } from "../src/gate/gate.js";
import { formatGateReceipt } from "../src/gate/receipt.js";
import {
  DEFAULT_LIFT_POLICY,
  DEFAULT_STATUS_REGRESSION_PP,
  DEFAULT_STATUS_REGRESSION_RUNS,
  DEFAULT_TASK_STATUS_MIN_RUNS,
  DEFAULT_TASK_STATUS_REGRESSION_RATE,
} from "../src/gate/types.js";

/** n runs, all accuracy 1; the first `failures` end with status `failure`. endStatus omitted when `withStatus` is false. */
function cell(p: {
  taskId: string;
  modelVariantId: string;
  variantId: string;
  n: number;
  failures: number;
  billed?: number;
  withStatus?: boolean;
}): TaskVariantReport {
  const withStatus = p.withStatus ?? true;
  const billed = p.billed ?? 1000;
  const runs = Array.from({ length: p.n }, (_, i) => ({
    runIndex: i,
    dimensions: [{ dimension: "accuracy" as const, score: 1 }],
    tokensUsed: billed,
    billedTokens: billed,
    durationMs: 10,
    status: "pass" as const,
    output: "",
    ...(withStatus ? { endStatus: i < p.failures ? "failure" : "success" } : {}),
  }));
  return {
    taskId: p.taskId,
    modelVariantId: p.modelVariantId,
    variantId: p.variantId,
    variantLabel: p.variantId,
    runs,
    meanScores: [{ dimension: "accuracy", score: 1 }],
    variance: 0,
    meanTokens: billed,
    meanBilledTokens: billed,
    meanCacheReadTokens: 0,
    meanDurationMs: 100,
    passRate: 1,
    solveRate: 1,
  } as TaskVariantReport;
}

function report(taskReports: TaskVariantReport[]): SessionReport {
  return {
    generatedAt: "2026-11-13T00:00:00Z",
    runs: [],
    sessionId: "test",
    sessionVersion: "1",
    gitSha: "testsha",
    taskReports,
    reproducibility: { judgeModelSha: "j", judgeCodeSha: "c", runId: "r", replayCommand: "x" },
  };
}

/** Two tasks x two tiers x n runs, accuracy 1.00 in every cell of both arms. */
function twoTierReport(opts: { baseFailures: number; headFailures: number; n?: number; withStatus?: boolean; headBilled?: number }): SessionReport {
  const n = opts.n ?? 3;
  const cells: TaskVariantReport[] = [];
  for (const modelVariantId of ["qwen3:4b", "cogito:8b"]) {
    for (const taskId of ["h3-continuation", "h3-exact-value"]) {
      cells.push(cell({ taskId, modelVariantId, variantId: "base", n, failures: opts.baseFailures, withStatus: opts.withStatus }));
      cells.push(cell({ taskId, modelVariantId, variantId: "head", n, failures: opts.headFailures, withStatus: opts.withStatus, billed: opts.headBilled }));
    }
  }
  return report(cells);
}

describe("run-status regression guard", () => {
  it("documents conservative defaults (25pp, 2 runs)", () => {
    expect(DEFAULT_STATUS_REGRESSION_PP).toBe(25);
    expect(DEFAULT_STATUS_REGRESSION_RUNS).toBe(2);
  });

  it("flat accuracy, head 12/12 status=failure vs base 0/12 -> reject on every tier", () => {
    const v = evaluateLiftGate(twoTierReport({ baseFailures: 0, headFailures: 3 }), "base", "head");
    expect(v.decision).toBe("reject");
    expect(v.perTier.every((t) => t.statusRegresses && t.regresses && !t.passes)).toBe(true);
    expect(v.perTier[0]?.liftPp).toBe(0);
    expect(v.perTier[0]?.runStatus).toMatchObject({ baselineNonSuccess: 0, candidateNonSuccess: 6, candidateRuns: 6 });
    expect(v.rationale).toContain("run-status regression");
  });

  it("rejects even when accuracy is underpowered (n=2 per cell)", () => {
    const v = evaluateLiftGate(twoTierReport({ baseFailures: 0, headFailures: 2, n: 2 }), "base", "head");
    expect(v.perTier.every((t) => t.underpowered)).toBe(true);
    expect(v.decision).toBe("reject");
  });

  it("clean arms (no non-success runs) are unchanged: not rejected", () => {
    const v = evaluateLiftGate(twoTierReport({ baseFailures: 0, headFailures: 0 }), "base", "head");
    expect(v.decision).not.toBe("reject");
    expect(v.perTier.every((t) => !t.statusRegresses)).toBe(true);
    expect(v.perTier[0]?.runStatus).toMatchObject({ candidateNonSuccess: 0 });
  });

  it("equal failure rates in both arms do not trip the guard", () => {
    const v = evaluateLiftGate(twoTierReport({ baseFailures: 2, headFailures: 2 }), "base", "head");
    expect(v.perTier.every((t) => !t.statusRegresses)).toBe(true);
    expect(v.decision).not.toBe("reject");
  });

  it("one flaky run (below 25pp and 2 excess runs) does not trip the guard", () => {
    // 2 tasks x 5 runs = 10 runs per tier arm; 1 failure = 10pp, 1 excess run.
    const cells: TaskVariantReport[] = [
      cell({ taskId: "a", modelVariantId: "m", variantId: "base", n: 5, failures: 0 }),
      cell({ taskId: "a", modelVariantId: "m", variantId: "head", n: 5, failures: 1 }),
      cell({ taskId: "b", modelVariantId: "m", variantId: "base", n: 5, failures: 0 }),
      cell({ taskId: "b", modelVariantId: "m", variantId: "head", n: 5, failures: 0 }),
    ];
    const [t] = projectTierEvidence(report(cells), "base", "head", DEFAULT_LIFT_POLICY);
    expect(t?.runStatus?.deltaPp).toBeCloseTo(10, 5);
    expect(t?.statusRegresses).toBe(false);
  });

  it("needs both pp and excess-run thresholds (1 failure in 3 runs = 33pp but 1 excess run)", () => {
    const cells = [
      cell({ taskId: "a", modelVariantId: "m", variantId: "base", n: 3, failures: 0 }),
      cell({ taskId: "a", modelVariantId: "m", variantId: "head", n: 3, failures: 1 }),
    ];
    const [t] = projectTierEvidence(report(cells), "base", "head");
    expect(t?.runStatus?.deltaPp).toBeCloseTo(33.3, 0);
    expect(t?.statusRegresses).toBe(false);
  });

  it("reports without endStatus are untouched (guard silent, no runStatus)", () => {
    const v = evaluateLiftGate(twoTierReport({ baseFailures: 0, headFailures: 3, withStatus: false }), "base", "head");
    expect(v.perTier.every((t) => t.runStatus === undefined && !t.statusRegresses)).toBe(true);
    expect(v.decision).not.toBe("reject");
  });

  it("the thresholds are overridable per policy", () => {
    const [t] = projectTierEvidence(twoTierReport({ baseFailures: 0, headFailures: 3 }), "base", "head", {
      ...DEFAULT_LIFT_POLICY,
      maxStatusRegressionPp: 101,
      taskStatusRegressionRate: 1.01,
    });
    expect(t?.statusRegresses).toBe(false);
  });

  it("reports the billed-token ratio per run and prints status + ratio in the receipt", () => {
    const v = evaluateLiftGate(twoTierReport({ baseFailures: 0, headFailures: 3, headBilled: 2800 }), "base", "head");
    expect(v.perTier[0]?.billedTokenRatio).toBeCloseTo(2.8, 5);
    const receipt = formatGateReceipt(v);
    expect(receipt).toContain("billed x2.80/run");
    expect(receipt).toContain("STATUS REGRESSION");
    expect(receipt).toContain("6/6 (100%)");
  });
});

describe("per-task run-status regression guard", () => {
  /** n runs of one task, the first `failures` end `failure`. */
  const taskPair = (taskId: string, n: number, baseFail: number, headFail: number, model = "m"): TaskVariantReport[] => [
    cell({ taskId, modelVariantId: model, variantId: "base", n, failures: baseFail }),
    cell({ taskId, modelVariantId: model, variantId: "head", n, failures: headFail }),
  ];
  /** Two flipped tasks hidden among eight clean ones: pooled delta = 6/30 = 20pp < 25pp. */
  const diluted = (): SessionReport =>
    report([
      ...taskPair("flip-1", 3, 0, 3),
      ...taskPair("flip-2", 3, 0, 3),
      ...["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].flatMap((id) => taskPair(id, 3, 0, 0)),
    ]);

  it("documents defaults (0.67, k>=3)", () => {
    expect(DEFAULT_TASK_STATUS_REGRESSION_RATE).toBe(0.67);
    expect(DEFAULT_TASK_STATUS_MIN_RUNS).toBe(3);
  });

  it("0/3 -> 3/3 on two tasks while the pooled rate is under threshold -> reject, receipt names the tasks", () => {
    const [t] = projectTierEvidence(diluted(), "base", "head");
    expect(t?.runStatus?.deltaPp).toBeLessThan(DEFAULT_STATUS_REGRESSION_PP);
    expect(t?.taskStatusRegressions?.map((x) => x.taskId)).toEqual(["flip-1", "flip-2"]);
    const v = evaluateLiftGate(diluted(), "base", "head");
    expect(v.decision).toBe("reject");
    const receipt = formatGateReceipt(v);
    expect(receipt).toContain("task flip-1");
    expect(receipt).toContain("task flip-2");
  });

  it("task already non-success at base (abstention) does not trip", () => {
    const [t] = projectTierEvidence(report(taskPair("trap", 3, 3, 3)), "base", "head");
    expect(t?.taskStatusRegressions).toEqual([]);
    expect(t?.statusRegresses).toBe(false);
  });

  it("2/3 non-success from 0/3 is not 'all or nearly all' -> silent", () => {
    const [t] = projectTierEvidence(report([...taskPair("a", 3, 0, 2), ...taskPair("b", 3, 0, 0)]), "base", "head");
    expect(t?.taskStatusRegressions).toEqual([]);
  });

  it("k<3 per arm -> per-task read silent", () => {
    const [t] = projectTierEvidence(report([...taskPair("a", 2, 0, 2), ...taskPair("b", 2, 0, 0)]), "base", "head");
    expect(t?.taskStatusRegressions).toEqual([]);
  });

  it("k=5: 4/5 from 0/5 trips, 3/5 does not; thresholds overridable", () => {
    const at = (fails: number, policy = DEFAULT_LIFT_POLICY) =>
      projectTierEvidence(report(taskPair("a", 5, 0, fails)), "base", "head", policy)[0]?.taskStatusRegressions?.length;
    expect(at(4)).toBe(1);
    expect(at(3)).toBe(0);
    expect(at(3, { ...DEFAULT_LIFT_POLICY, taskStatusRegressionRate: 0.5 })).toBe(1);
    expect(at(5, { ...DEFAULT_LIFT_POLICY, minTaskStatusRuns: 6 })).toBe(0);
  });

  const SESSION = new URL(
    "../../../wiki/Research/Harness-Reports/2026-11-13-recent-default-harness-ablation/session-v2.json",
    import.meta.url,
  );
  const real = (): SessionReport => JSON.parse(readFileSync(SESSION, "utf8")) as SessionReport;

  it("real 12-task H3 data: base vs fixhead (h3-continuation/h3-exact-value 0/3 -> 3/3 failure) -> reject via per-task read", () => {
    const v = evaluateLiftGate(real(), "base", "fixhead");
    expect(v.decision).toBe("reject");
    const flagged = v.perTier.flatMap((t) => (t.taskStatusRegressions ?? []).map((x) => x.taskId));
    expect(flagged.sort()).toEqual(
      ["h3-continuation", "h3-continuation", "h3-exact-value", "h3-exact-value"].sort(),
    );
    // The pooled read alone stayed silent on the full suite (the gap this guard closes).
    const pooledOnly = projectTierEvidence(real(), "base", "fixhead", {
      ...DEFAULT_LIFT_POLICY,
      taskStatusRegressionRate: 1.01,
    });
    expect(pooledOnly.every((t) => !t.statusRegresses)).toBe(true);
  });

  it("real data sanity: pre-fix head vs fixhead (both broken the same way) and base vs itself -> no per-task regression", () => {
    const r = real();
    const sameTwice: SessionReport = {
      ...r,
      taskReports: [
        ...r.taskReports.filter((c) => c.variantId === "base"),
        ...r.taskReports.filter((c) => c.variantId === "base").map((c) => ({ ...c, variantId: "base-copy" })),
      ],
    };
    for (const [rep, a, b] of [
      [sameTwice, "base", "base-copy"],
      [r, "head795", "fixhead"],
    ] as const) {
      const ev = projectTierEvidence(rep, a, b);
      expect(ev.length).toBeGreaterThan(0);
      expect(ev.every((t) => (t.taskStatusRegressions ?? []).length === 0 && !t.statusRegresses)).toBe(true);
    }
  });
});
