/**
 * Statistical primitives for the eval measurement overhaul (Task 6). Pure
 * functions, no Effect — these are cheap enough to call synchronously inside
 * `eval-service.ts`'s aggregation code.
 *
 * The core problem this replaces: `EvalService.compare`/`checkRegression`
 * flagged a regression on a flat ±0.02 delta regardless of how noisy the
 * underlying scores were. Bench cells are Bernoulli-ish and a single run's
 * delta can easily exceed 0.02 from noise alone (see MEMORY: "5 tasks×n≤5
 * has ~13pp SE, gaps <26pp are noise"). These functions let a caller replace
 * that fixed threshold with one derived from the ACTUAL observed variance
 * and sample size — the minimum effect size that sample size could reliably
 * detect (MDE) — while keeping the flat threshold as an honest fallback when
 * there's only one sample to look at (`repeats: 1`, the default).
 */

/** Arithmetic mean. Empty input returns `0` (matches the codebase's existing convention — see `buildSummary`). */
export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Sample standard deviation (Bessel-corrected, n-1 denominator — the right
 * estimator when the samples are a subset of possible repeats, not the
 * whole population). A single sample has no defined spread; returns `0`.
 */
export const sampleStddev = (xs: readonly number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const sumSq = xs.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(sumSq / (xs.length - 1));
};

/** Standard error of the mean. */
export const standardError = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : sampleStddev(xs) / Math.sqrt(xs.length);

/** 95% Wald confidence interval on the mean (normal approximation — adequate at the repeat counts this plan targets, N=10-30). */
export const confidenceInterval95 = (xs: readonly number[]): readonly [number, number] => {
  const m = mean(xs);
  const half = 1.96 * standardError(xs);
  return [m - half, m + half];
};

/**
 * Minimum detectable effect for a two-sample mean comparison (current run
 * vs. baseline) at 95% confidence, given each side's stddev and sample size.
 * A delta smaller than this is indistinguishable from noise at this sample
 * size — the statistically-grounded replacement for a flat epsilon.
 *
 * Uses the larger of the two stddevs (conservative — doesn't understate the
 * detectable effect when one side is noisier) and the smaller of the two
 * sample sizes (the weaker side sets the floor).
 */
export const minimumDetectableEffect = (
  currentStddev: number,
  currentN: number,
  baselineStddev: number,
  baselineN: number,
): number => {
  const n = Math.min(Math.max(1, currentN), Math.max(1, baselineN));
  const pooledStddev = Math.max(currentStddev, baselineStddev);
  return 1.96 * Math.SQRT2 * (pooledStddev / Math.sqrt(n));
};

/**
 * One repeat-count-aware sample's stats. Internal computation shape (`ci95`
 * as a tuple) — the public, run-level shape is `DimensionVarianceStats` in
 * `types/eval-result.ts` (flat `ci95Low`/`ci95High`, matching its
 * `Schema.Struct`); `eval-service.ts`'s `buildSummary` converts between the
 * two. Deliberately NOT re-exported under a colliding name from the
 * package's `index.ts`.
 */
export interface RepeatStats {
  readonly mean: number;
  readonly stddev: number;
  readonly n: number;
  readonly ci95: readonly [number, number];
}

export const summarizeRepeats = (xs: readonly number[]): RepeatStats => ({
  mean: mean(xs),
  stddev: sampleStddev(xs),
  n: xs.length,
  ci95: confidenceInterval95(xs),
});

/**
 * Pools several groups' repeat stats into ONE within-group estimate — the
 * classic pooled-variance formula: `sum((n_i-1)*var_i) / sum(n_i-1)`.
 *
 * Load-bearing distinction (code review, 2026-09-22): concatenating every
 * case's raw repeat scores into one flat array and taking ITS stddev
 * conflates two different sources of spread — real case-to-case quality
 * differences (between-group variance) and judge repeat-noise on the SAME
 * output (within-group variance, what this measurement is actually meant
 * to isolate). Pooling each case's own `RepeatStats` instead keeps only the
 * within-group component: a run with two cases scoring a rock-steady 0.95
 * and 0.60 respectively (zero judge noise, real quality gap) pools to
 * `stddev: 0`, correctly — not the ~0.17 a flat concatenation would report.
 *
 * The mean is the sample-size-weighted grand mean; `n` is the total pooled
 * sample count (matches `minimumDetectableEffect`'s degrees-of-freedom
 * expectation). Groups with `n < 2` contribute their mean to the grand mean
 * but no variance (a single sample has no defined spread — `sampleStddev`'s
 * own convention).
 */
export const pooledStats = (groups: readonly RepeatStats[]): RepeatStats => {
  const withData = groups.filter((g) => g.n > 0);
  if (withData.length === 0) return { mean: 0, stddev: 0, n: 0, ci95: [0, 0] };

  const totalN = withData.reduce((a, g) => a + g.n, 0);
  const grandMean = withData.reduce((a, g) => a + g.mean * g.n, 0) / totalN;

  const numerator = withData.reduce((a, g) => a + Math.max(0, g.n - 1) * g.stddev ** 2, 0);
  const denominator = withData.reduce((a, g) => a + Math.max(0, g.n - 1), 0);
  const pooledVariance = denominator > 0 ? numerator / denominator : 0;
  const pooledStddev = Math.sqrt(pooledVariance);

  const pooledSe = totalN > 0 ? pooledStddev / Math.sqrt(totalN) : 0;
  const half = 1.96 * pooledSe;

  return { mean: grandMean, stddev: pooledStddev, n: totalN, ci95: [grandMean - half, grandMean + half] };
};

/**
 * Reliability-diagram calibration check (Task 6 Step 3): buckets predicted
 * probabilities and compares each bucket's average prediction against its
 * observed correctness rate. A well-calibrated judge has `predictedMean ≈
 * observedRate` in every bucket with enough samples to trust — this is the
 * guard against "typed output guarantees the interface, not truth"
 * (docs.typesafe.ai/concepts/how-to-build-with-system-one.md).
 *
 * `labeled` is ground-truth-labeled data: each item's model-reported
 * `probability` (a Noul probability, or a Choice/Score confidence) paired
 * with whether that prediction was actually `correct` against a known
 * label. Requires a labeled dataset to run against — see Task 6 Step 5's
 * frozen-dataset study, not yet executed as of this commit (this function
 * is the instrument; running it against real RA data is separate work).
 */
export interface CalibrationBucket {
  readonly bucketLabel: string;
  readonly predictedMean: number;
  readonly observedRate: number;
  readonly n: number;
}

export const checkCalibration = (
  labeled: ReadonlyArray<{ readonly probability: number; readonly correct: boolean }>,
  bucketCount = 5,
): readonly CalibrationBucket[] => {
  const buckets: { probs: number[]; correct: number[] }[] = Array.from({ length: bucketCount }, () => ({
    probs: [],
    correct: [],
  }));
  for (const item of labeled) {
    const clamped = Math.max(0, Math.min(1 - 1e-9, item.probability));
    const idx = Math.floor(clamped * bucketCount);
    buckets[idx]!.probs.push(item.probability);
    buckets[idx]!.correct.push(item.correct ? 1 : 0);
  }
  return buckets.map((b, i) => {
    const lo = i / bucketCount;
    const hi = (i + 1) / bucketCount;
    return {
      bucketLabel: `${lo.toFixed(2)}-${hi.toFixed(2)}`,
      predictedMean: mean(b.probs),
      observedRate: mean(b.correct),
      n: b.probs.length,
    };
  });
};
