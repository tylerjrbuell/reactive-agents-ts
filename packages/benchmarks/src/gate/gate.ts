// File: src/gate/gate.ts
import type { SessionReport, TaskVariantReport } from "../types.js";
import {
  DEFAULT_LIFT_POLICY,
  type ClassVerdict,
  type GateDecision,
  type GateVerdict,
  type LiftGateOptions,
  type LiftPolicy,
  type TaskClass,
  type TierEvidence,
} from "./types.js";

/**
 * The tag that discriminates a long-horizon task (audit 06). The gate reads
 * this off the task descriptors passed in `LiftGateOptions.tasks` — it never
 * hardcodes task IDs, so new long-horizon tasks are classified automatically by
 * carrying the tag.
 */
export const LONG_HORIZON_TAG = "horizon:long";

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function maxOf(xs: readonly number[]): number {
  return xs.reduce((m, x) => (x > m ? x : m), 0);
}

/**
 * The spread (0..1 score units) of a single cell's per-run metric.
 *
 * Why not just the sample standard deviation: it is 0 whenever every run in the
 * cell scored alike — trivially true at n=1, and common for saturated cells
 * ([1,1,1]). A zero spread makes the noise floor zero, and a zero floor means
 * any difference at all reads as "significant". That was the original defect.
 *
 * So we use the Agresti-smoothed Bernoulli spread √(p̃(1−p̃)) with
 * p̃ = (x+1)/(n+2). It is strictly positive for every n, and because every
 * metric here is bounded to [0,1], p(1−p) upper-bounds the true variance of a
 * graded score with the same mean — the estimate is conservative by
 * construction. It also converges toward the observed rate as n grows.
 */
function cellSpread(r: TaskVariantReport, metric: string): number {
  const n = r.runs?.length ?? 0;
  const p = metricScore(r, metric) ?? 0;
  const pTilde = (p * n + 1) / (n + 2);
  return Math.sqrt(pTilde * (1 - pTilde));
}

/** Standard error of one cell's mean: sd/√n. `n=0` (no runs) → treat as n=1. */
function cellStdErr(r: TaskVariantReport, metric: string): number {
  const n = Math.max(1, r.runs?.length ?? 0);
  return cellSpread(r, metric) / Math.sqrt(n);
}

function metricScore(r: TaskVariantReport, metric: string): number | undefined {
  return r.meanScores.find((s) => s.dimension === metric)?.score;
}

/** Set of task IDs classified `long-horizon` from the supplied descriptors. */
function longHorizonIds(options: LiftGateOptions | undefined): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const t of options?.tasks ?? []) {
    if ((t.tags ?? []).includes(LONG_HORIZON_TAG)) ids.add(t.id);
  }
  return ids;
}

/**
 * Build the evidence row for one (model × task-class) cell. The ONLY thing that
 * differs by class is the cost half of `passes`:
 *
 * - `short` — token overhead ≤ `maxTokenOverheadPct` (historical rule).
 * - `long-horizon` — cost-per-verified-deliverable. The candidate must bank
 *   verified deliverables (pass-rate > 0 ⇒ finite CPD) and must not make the
 *   deliverable more expensive per unit than the baseline UNLESS it delivers a
 *   higher pass-rate. Raw token growth alone never fails the gate; zero
 *   delivery (infinite CPD) always does.
 */
function computeEvidence(
  model: string,
  base: readonly TaskVariantReport[],
  cand: readonly TaskVariantReport[],
  policy: LiftPolicy,
  taskClass: TaskClass,
): TierEvidence {
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

  // ── Significance: standard ERROR of the difference, not standard deviation ──
  // A stddev describes the spread of individual runs; it never shrinks with n
  // and is exactly 0 when n=1 (or when every run in a cell scored alike). Using
  // it as a noise floor made the gate rubber-stamp noise at n=1 (bar 0pp) and
  // reject every achievable effect at n>1 (bar ≈ 50pp on Bernoulli cells).
  //
  // The uncertainty about a MEAN is se = sd/√n, and the uncertainty about the
  // DIFFERENCE of two independent means is √(se_b² + se_c²). Both shrink as
  // √n — which is what makes "run it more times" a way to earn a verdict.
  const seOfGroup = (rows: readonly TaskVariantReport[]): number => {
    if (rows.length === 0) return 0;
    // Variance of a mean-of-k-cell-means = (1/k²)·Σ se_i².
    const sumSq = rows.reduce((acc, r) => acc + cellStdErr(r, policy.metric) ** 2, 0);
    return Math.sqrt(sumSq) / rows.length;
  };
  const stdErr = Math.sqrt(seOfGroup(base) ** 2 + seOfGroup(cand) ** 2);
  const stdErrPp = stdErr * 100;
  const noisePp = policy.significanceK * stdErrPp;

  const minRunsObserved = Math.min(
    ...[...base, ...cand].map((r) => r.runs?.length ?? 0),
  );
  const underpowered = minRunsObserved < policy.minRuns;

  // Runs/arm to resolve `minLiftPp` at the observed spread (equal-n, z=K).
  const sd = maxOf([...base, ...cand].map((r) => cellSpread(r, policy.metric)));
  const delta = policy.minLiftPp / 100;
  const runsNeeded =
    delta > 0 ? Math.ceil((2 * policy.significanceK ** 2 * sd ** 2) / delta ** 2) : 0;

  // An underpowered tier may neither pass nor regress: we did not look hard
  // enough to say anything, and saying "no effect" would be a lie.
  const significant = !underpowered && Math.abs(liftPp) > noisePp;

  // Cost half of the bar — the sole class-dependent decision.
  let costOk: boolean;
  let longHorizonFields: Pick<TierEvidence, "taskClass" | "costPerDeliverable"> = {};
  if (taskClass === "long-horizon") {
    // Deliverable-check pass-rate = the partial-credit metric score (0..1),
    // already computed in the result rows. CPD = tokens ÷ pass-rate.
    const candCPD =
      candidateMetric > 0 ? candTokens / candidateMetric : Number.POSITIVE_INFINITY;
    const baseCPD =
      baselineMetric > 0 ? baseTokens / baselineMetric : Number.POSITIVE_INFINITY;
    const zeroDelivery = candidateMetric <= 0;
    costOk =
      !zeroDelivery && (candCPD <= baseCPD || candidateMetric >= baselineMetric);
    longHorizonFields = { taskClass: "long-horizon", costPerDeliverable: candCPD };
  } else {
    costOk = tokenOverheadPct <= policy.maxTokenOverheadPct;
  }

  const passes =
    !inconclusive && !underpowered && significant && liftPp >= policy.minLiftPp && costOk;
  const regresses = !inconclusive && !underpowered && significant && liftPp < 0;

  // NOTE: when `inconclusive` is true, the numeric fields below are not meaningful — consumers MUST gate on `inconclusive` before reading liftPp/tokenOverheadPct.
  return {
    tier: model,
    baselineMetric,
    candidateMetric,
    liftPp,
    tokenOverheadPct,
    variance,
    noisePp,
    stdErrPp,
    minRunsObserved,
    underpowered,
    runsNeeded,
    significant,
    inconclusive,
    passes,
    regresses,
    ...longHorizonFields,
  };
}

export function projectTierEvidence(
  report: SessionReport,
  baselineVariantId: string,
  candidateVariantId: string,
  policy: LiftPolicy = DEFAULT_LIFT_POLICY,
  options?: LiftGateOptions,
): readonly TierEvidence[] {
  const reports = report.taskReports ?? [];
  const longIds = longHorizonIds(options);
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

    // Partition this model's cells by task class. When no long-horizon task is
    // classified (no options, or none tagged), the long partitions are empty
    // and only the historical short row is emitted → byte-identical output.
    const isLong = (r: TaskVariantReport): boolean => longIds.has(r.taskId);
    const shortBase = base.filter((r) => !isLong(r));
    const shortCand = cand.filter((r) => !isLong(r));
    const longBase = base.filter(isLong);
    const longCand = cand.filter(isLong);

    if (shortBase.length > 0 && shortCand.length > 0) {
      evidence.push(computeEvidence(model, shortBase, shortCand, policy, "short"));
    }
    if (longBase.length > 0 && longCand.length > 0) {
      evidence.push(
        computeEvidence(model, longBase, longCand, policy, "long-horizon"),
      );
    }
  }

  return evidence;
}

/** Distinct measurement tiers (models) covered — not the raw row count. */
function tiersCoveredOf(perTier: readonly TierEvidence[]): number {
  return new Set(perTier.map((t) => t.tier)).size;
}

/** The decision function, applied to a set of evidence rows (all or one class). */
function decide(
  perTier: readonly TierEvidence[],
  policy: LiftPolicy,
): {
  decision: GateDecision;
  aggregate: ClassVerdict["aggregate"];
  partial: boolean;
} {
  const partial = perTier.some((t) => t.inconclusive);
  const tiersCovered = tiersCoveredOf(perTier);
  const conclusive = perTier.filter((t) => !t.inconclusive);
  const aggregate = {
    liftPp: mean(conclusive.map((t) => t.liftPp)),
    tokenOverheadPct: mean(conclusive.map((t) => t.tokenOverheadPct)),
    tiersCovered,
  };

  let decision: GateDecision;
  if (perTier.some((t) => t.regresses)) {
    // A confirmed regression at adequate n outranks everything.
    decision = "reject";
  } else if (perTier.some((t) => t.underpowered)) {
    // Not "no effect" — not enough samples to say. Reported as itself so an
    // under-sampled run can never masquerade as evidence in either direction.
    decision = "underpowered";
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

  return { decision, aggregate, partial };
}

function buildRationale(
  decision: GateDecision,
  aggregate: GateVerdict["aggregate"],
  partial: boolean,
  policy: LiftPolicy,
  /** True when at least one tier's |lift| cleared its noise bar. */
  anySignificant = true,
): string {
  const lift = aggregate.liftPp.toFixed(1);
  const tok = aggregate.tokenOverheadPct.toFixed(1);
  const base = `${decision.toUpperCase()} · ${aggregate.tiersCovered} tier(s) · ${lift}pp lift · ${tok}% tok`;
  if (decision === "underpowered")
    return `${base} — too few runs to resolve ≥${policy.minLiftPp}pp; this is NOT evidence of no effect`;
  if (decision === "reject") return `${base} — a tier significantly regresses`;
  if (decision === "default-on") return `${base} — clears ≥${policy.minLiftPp}pp ∧ ≤${policy.maxTokenOverheadPct}% on all tiers`;
  if (partial) return `${base} — inconclusive tier blocks promotion`;
  // A result inside the noise band measured NOTHING. Printing "below the
  // promotion bar" makes it read as a near-miss, and "opt-in" reads as a weak
  // endorsement — both wrong. Observed on a real ablation whose two n=3 runs of
  // the SAME comparison flipped sign (+4.5pp, then -10.6pp).
  if (!anySignificant)
    return `${base} — within the noise floor; no measurable effect (NOT evidence of equivalence)`;
  return `${base} — below the promotion bar`;
}

export function evaluateLiftGate(
  report: SessionReport,
  baselineVariantId: string,
  candidateVariantId: string,
  policy: LiftPolicy = DEFAULT_LIFT_POLICY,
  options?: LiftGateOptions,
): GateVerdict {
  const perTier = projectTierEvidence(
    report,
    baselineVariantId,
    candidateVariantId,
    policy,
    options,
  );

  const top = decide(perTier, policy);

  // Per-class breakdown — emitted only when the long-horizon class is actually
  // present, otherwise the verdict is byte-identical to the pre-amendment shape.
  const classes = Array.from(
    new Set(perTier.map((t): TaskClass => t.taskClass ?? "short")),
  );
  const byClass: readonly ClassVerdict[] | undefined = classes.includes(
    "long-horizon",
  )
    ? classes.map((taskClass): ClassVerdict => {
        const rows = perTier.filter(
          (t) => (t.taskClass ?? "short") === taskClass,
        );
        const d = decide(rows, policy);
        return {
          taskClass,
          decision: d.decision,
          perTier: rows,
          aggregate: d.aggregate,
          partial: d.partial,
        };
      })
    : undefined;

  return {
    decision: top.decision,
    perTier,
    aggregate: top.aggregate,
    partial: top.partial,
    rationale: buildRationale(
      top.decision,
      top.aggregate,
      top.partial,
      policy,
      perTier.some((t) => t.significant),
    ),
    baselineVariantId,
    candidateVariantId,
    ...(byClass ? { byClass } : {}),
  };
}
