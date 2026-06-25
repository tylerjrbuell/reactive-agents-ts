// File: src/gate/gate.ts
import type { SessionReport, TaskVariantReport } from "../types.js";
import {
  DEFAULT_LIFT_POLICY,
  type GateDecision,
  type GateVerdict,
  type LiftPolicy,
  type TierEvidence,
} from "./types.js";

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function maxOf(xs: readonly number[]): number {
  return xs.reduce((m, x) => (x > m ? x : m), 0);
}

function metricScore(r: TaskVariantReport, metric: string): number | undefined {
  return r.meanScores.find((s) => s.dimension === metric)?.score;
}

export function projectTierEvidence(
  report: SessionReport,
  baselineVariantId: string,
  candidateVariantId: string,
  policy: LiftPolicy = DEFAULT_LIFT_POLICY,
): readonly TierEvidence[] {
  const reports = report.taskReports ?? [];
  const models = Array.from(new Set(reports.map((r) => r.modelVariantId)));
  const evidence: TierEvidence[] = [];

  for (const model of models) {
    const base = reports.filter(
      (r) => r.modelVariantId === model && r.variantId === baselineVariantId,
    );
    const cand = reports.filter(
      (r) => r.modelVariantId === model && r.variantId === candidateVariantId,
    );
    if (base.length === 0 || cand.length === 0) continue;

    const inconclusive =
      base.some((r) => r.inconclusive !== undefined) ||
      cand.some((r) => r.inconclusive !== undefined) ||
      base.some((r) => metricScore(r, policy.metric) === undefined) ||
      cand.some((r) => metricScore(r, policy.metric) === undefined);

    const baselineMetric = mean(base.map((r) => metricScore(r, policy.metric) ?? 0));
    const candidateMetric = mean(cand.map((r) => metricScore(r, policy.metric) ?? 0));
    const liftPp = (candidateMetric - baselineMetric) * 100;

    const baseTokens = mean(base.map((r) => r.meanTokens));
    const candTokens = mean(cand.map((r) => r.meanTokens));
    const tokenOverheadPct =
      baseTokens === 0 ? 0 : ((candTokens - baseTokens) / baseTokens) * 100;

    const variance = maxOf([
      ...base.map((r) => r.variance),
      ...cand.map((r) => r.variance),
    ]);
    const noisePp = policy.significanceK * variance * 100;
    const significant = Math.abs(liftPp) > noisePp;

    const passes =
      !inconclusive &&
      significant &&
      liftPp >= policy.minLiftPp &&
      tokenOverheadPct <= policy.maxTokenOverheadPct;
    const regresses = !inconclusive && significant && liftPp < 0;

    // NOTE: when `inconclusive` is true, the numeric fields below are not meaningful — consumers MUST gate on `inconclusive` before reading liftPp/tokenOverheadPct.
    evidence.push({
      tier: model,
      baselineMetric,
      candidateMetric,
      liftPp,
      tokenOverheadPct,
      variance,
      significant,
      inconclusive,
      passes,
      regresses,
    });
  }

  return evidence;
}

function buildRationale(
  decision: GateDecision,
  aggregate: GateVerdict["aggregate"],
  partial: boolean,
  policy: LiftPolicy,
): string {
  const lift = aggregate.liftPp.toFixed(1);
  const tok = aggregate.tokenOverheadPct.toFixed(1);
  const base = `${decision.toUpperCase()} · ${aggregate.tiersCovered} tier(s) · ${lift}pp lift · ${tok}% tok`;
  if (decision === "reject") return `${base} — a tier significantly regresses`;
  if (decision === "default-on") return `${base} — clears ≥${policy.minLiftPp}pp ∧ ≤${policy.maxTokenOverheadPct}% on all tiers`;
  if (partial) return `${base} — inconclusive tier blocks promotion`;
  return `${base} — below the promotion bar`;
}

export function evaluateLiftGate(
  report: SessionReport,
  baselineVariantId: string,
  candidateVariantId: string,
  policy: LiftPolicy = DEFAULT_LIFT_POLICY,
): GateVerdict {
  const perTier = projectTierEvidence(
    report,
    baselineVariantId,
    candidateVariantId,
    policy,
  );
  const partial = perTier.some((t) => t.inconclusive);
  const tiersCovered = perTier.length;
  const conclusive = perTier.filter((t) => !t.inconclusive);
  const aggregate = {
    liftPp: mean(conclusive.map((t) => t.liftPp)),
    tokenOverheadPct: mean(conclusive.map((t) => t.tokenOverheadPct)),
    tiersCovered,
  };

  let decision: GateDecision;
  if (perTier.some((t) => t.regresses)) {
    decision = "reject";
  } else if (
    !partial &&
    tiersCovered >= policy.minTiers &&
    perTier.length > 0 &&
    perTier.every((t) => t.passes)
  ) {
    decision = "default-on";
  } else {
    decision = "opt-in";
  }

  return {
    decision,
    perTier,
    aggregate,
    partial,
    rationale: buildRationale(decision, aggregate, partial, policy),
    baselineVariantId,
    candidateVariantId,
  };
}
