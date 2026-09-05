// Run: bun test packages/benchmarks/tests/gate-billed-token-leg.test.ts
//
// 2026-08-24 amendment §4: the lift gate's cost leg now scores BILLED tokens
// (`input − cacheRead + output`) by default, not raw tokens. Raw stopped
// tracking cost once prompt caching shipped — a cached prefix read bills at
// roughly a tenth of a fresh one but was counted at full price, so the raw
// leg penalised the one mechanism that caches by construction
// (RA_STABLE_TOOL_SURFACE: +33.3% raw tokens, -4.4% money). Raw is retained
// (`tokenOverheadPct`, `policy.tokenLeg: "raw"`) — never deleted, only no
// longer the default the AND is evaluated on.
//
// `projectTierEvidence` takes a `SessionReport`-shaped report, not a flat
// baseline/candidate object — the fixture builders below (`scores`, `runsOf`,
// `tvr`, `makeReport`) are copied verbatim from `gate.test.ts` (not exported
// from that file) so this test drives the REAL function.

import { describe, expect, it } from "bun:test";
import type {
  DimensionScore,
  SessionReport,
  TaskVariantReport,
} from "../src/types.js";
import { evaluateLiftGate, projectTierEvidence } from "../src/gate/gate.js";
import { DEFAULT_LIFT_POLICY } from "../src/gate/types.js";

// ── fixture builders (copied verbatim from gate.test.ts, not exported there) ─
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

// The RA_STABLE_TOOL_SURFACE shape (spec F-3): +33% RAW tokens, but the extra
// is all cache reads, so billed overhead is NEGATIVE.
const cachingArm = () =>
  makeReport([
    tvr({
      modelVariantId: "haiku",
      variantId: "base",
      accuracy: 0.6,
      meanTokens: 30_000,
      meanBilledTokens: 30_000,
      meanCacheReadTokens: 0,
    }),
    tvr({
      modelVariantId: "haiku",
      variantId: "cand",
      accuracy: 0.7,
      meanTokens: 40_000,
      meanBilledTokens: 28_000,
      meanCacheReadTokens: 12_000,
    }),
  ]);

describe("billed token leg", () => {
  it("defaults to the billed leg", () => {
    expect(DEFAULT_LIFT_POLICY.tokenLeg).toBe("billed");
  });

  it("passes a caching arm that the raw leg would fail", () => {
    const [evidence] = projectTierEvidence(
      cachingArm(),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );

    // `TierEvidence` does not expose the internal `costOk` boolean directly —
    // it folds into `passes` alongside lift/significance/passK. This fixture
    // (n=1000, +10pp lift, single task) clears every OTHER leg of the AND
    // (lift ≥ 3pp, promotable, not underpowered/inconclusive, passK
    // non-regressing), so `passes` here is exactly a read on `costOk`.
    expect(Math.round(evidence!.tokenOverheadPct)).toBe(33);
    expect(Math.round(evidence!.billedTokenOverheadPct)).toBe(-7);
    expect(evidence!.passes).toBe(true);
  });

  it("fails the same arm under the raw leg, proving the legs differ", () => {
    const [evidence] = projectTierEvidence(cachingArm(), "base", "cand", {
      ...DEFAULT_LIFT_POLICY,
      tokenLeg: "raw",
    });

    // Same lift (+10pp) and same significance either way — only the cost leg
    // flips, so `passes` (which folds costOk into the AND) is the observable
    // proxy for costOk without a private field.
    expect(evidence!.passes).toBe(false);
  });

  it("still fails an arm that is genuinely more expensive in billed terms", () => {
    const [evidence] = projectTierEvidence(
      makeReport([
        tvr({
          modelVariantId: "haiku",
          variantId: "base",
          accuracy: 0.6,
          meanTokens: 30_000,
          meanBilledTokens: 30_000,
          meanCacheReadTokens: 0,
        }),
        tvr({
          modelVariantId: "haiku",
          variantId: "cand",
          accuracy: 0.7,
          meanTokens: 45_000,
          meanBilledTokens: 44_000,
          meanCacheReadTokens: 1_000,
        }),
      ]),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );

    expect(Math.round(evidence!.billedTokenOverheadPct)).toBe(47);
    expect(evidence!.passes).toBe(false);
  });

  it("reports the candidate cache-hit rate", () => {
    const [evidence] = projectTierEvidence(
      cachingArm(),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );

    expect(evidence!.cacheHitRate).toBeCloseTo(0.3, 2); // 12000 / 40000
  });
});

// ── C1: archived reports (no billed fields at all) ──────────────────────────
//
// `meanBilledTokens` / `meanCacheReadTokens` did not exist before this
// amendment. Any SessionReport archived earlier — and the branch's own stated
// promise is that those stay re-auditable — simply has no such keys. When the
// gate read them unguarded, `mean(undefined)` produced NaN, `NaN <=
// maxTokenOverheadPct` is false, and the cost leg silently failed EVERY tier
// on EVERY archived report. These fixtures OMIT the fields rather than setting
// them, which is the only shape that reproduces that bug.

/** `tvr` with the two billed fields genuinely absent from the object. */
function archivedTvr(p: Parameters<typeof tvr>[0]): TaskVariantReport {
  const { meanBilledTokens: _b, meanCacheReadTokens: _c, ...rest } = tvr(p);
  return rest;
}

describe("archived reports without billed fields", () => {
  const archivedArm = () =>
    makeReport([
      archivedTvr({
        modelVariantId: "haiku",
        variantId: "base",
        accuracy: 0.6,
        meanTokens: 30_000,
      }),
      archivedTvr({
        modelVariantId: "haiku",
        variantId: "cand",
        accuracy: 0.7,
        meanTokens: 33_000,
      }),
      archivedTvr({
        modelVariantId: "sonnet",
        variantId: "base",
        accuracy: 0.6,
        meanTokens: 30_000,
      }),
      archivedTvr({
        modelVariantId: "sonnet",
        variantId: "cand",
        accuracy: 0.7,
        meanTokens: 33_000,
      }),
    ]);

  it("falls back to raw, so both legs agree and neither is NaN", () => {
    const [evidence] = projectTierEvidence(
      archivedArm(),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );

    expect(Number.isNaN(evidence!.billedTokenOverheadPct)).toBe(false);
    expect(evidence!.billedTokenOverheadPct).toBeCloseTo(
      evidence!.tokenOverheadPct,
      10,
    );
    expect(Number.isFinite(evidence!.cacheHitRate)).toBe(true);
    expect(evidence!.cacheHitRate).toBe(0);
  });

  it("still produces a real verdict instead of a silent always-false cost leg", () => {
    const verdict = evaluateLiftGate(
      archivedArm(),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );

    // +10pp lift at +10% raw overhead across two tiers clears the rule. Under
    // the NaN bug this scored `opt-in` no matter what the numbers said.
    expect(verdict.decision).toBe("default-on");
    expect(Number.isNaN(verdict.aggregate.billedTokenOverheadPct)).toBe(false);
  });

  it("fails an archived arm that is genuinely too expensive", () => {
    const verdict = evaluateLiftGate(
      makeReport([
        archivedTvr({
          modelVariantId: "haiku",
          variantId: "base",
          accuracy: 0.6,
          meanTokens: 30_000,
        }),
        archivedTvr({
          modelVariantId: "haiku",
          variantId: "cand",
          accuracy: 0.7,
          meanTokens: 60_000,
        }),
      ]),
      "base",
      "cand",
      DEFAULT_LIFT_POLICY,
    );

    // The leg must still BITE — the fallback restores pre-amendment scoring,
    // it does not disable the cost check.
    expect(verdict.decision).not.toBe("default-on");
  });
});
