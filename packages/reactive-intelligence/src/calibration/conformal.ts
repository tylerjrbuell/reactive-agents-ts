import type { ModelCalibration } from "../types.js";

/**
 * Compute the conformal quantile threshold.
 * q̂ = scores[⌈(N+1)(1-α)⌉ - 1]
 */
export function computeConformalThreshold(
  sortedScores: readonly number[],
  alpha: number,
): number {
  const N = sortedScores.length;
  const idx = Math.min(Math.ceil((N + 1) * (1 - alpha)) - 1, N - 1);
  return sortedScores[idx];
}

/**
 * Compute calibration for a model based on historical entropy scores.
 * Requires at least 20 samples to produce a calibrated result.
 */
export function computeCalibration(
  modelId: string,
  allScores: readonly number[],
): ModelCalibration {
  const sampleCount = allScores.length;

  if (sampleCount < 20) {
    return {
      modelId,
      calibrationScores: allScores,
      sampleCount,
      highEntropyThreshold: 0,
      convergenceThreshold: 0,
      calibrated: false,
      lastUpdated: Date.now(),
      driftDetected: false,
    };
  }

  // Sort scores for quantile computation
  const sorted = [...allScores].sort((a, b) => a - b);

  // highEntropyThreshold: α=0.10 (90th percentile)
  const highEntropyThreshold = computeConformalThreshold(sorted, 0.10);

  // convergenceThreshold: α=0.30 (70th percentile, looser)
  const convergenceThreshold = computeConformalThreshold(sorted, 0.30);

  // Drift detection: check if last 3-5 scores exceed mean + 2σ
  const mean = allScores.reduce((s, v) => s + v, 0) / sampleCount;
  const variance =
    allScores.reduce((s, v) => s + (v - mean) ** 2, 0) / sampleCount;
  const stddev = Math.sqrt(variance);

  const recentCount = Math.min(5, Math.max(3, sampleCount));
  const recentScores = allScores.slice(-recentCount);
  const driftDetected = recentScores.some(
    (score) => score > mean + 2 * stddev,
  );

  return {
    modelId,
    calibrationScores: allScores,
    sampleCount,
    highEntropyThreshold,
    convergenceThreshold,
    calibrated: true,
    lastUpdated: Date.now(),
    driftDetected,
  };
}

/**
 * Fewest scores a run needs before its own drift measurement means anything.
 * The recent window is at most 5 scores; with fewer than 10 the window is half
 * the run or more, so the recent mean is mostly the run mean and the deviation
 * collapses toward 0σ (with n ≤ 5 the two are identical and it is exactly 0σ).
 */
export const CALIBRATION_DRIFT_MIN_SAMPLES = 10;

/**
 * Smallest recent-window deviation, in run standard deviations, that counts as
 * drift worth publishing. The detector flags a single recent score above
 * mean + 2σ; for the mean of a 5-score window the equivalent bar is
 * 2/√5 ≈ 0.9σ, rounded up to 1σ.
 */
export const CALIBRATION_DRIFT_MIN_SIGMA = 1;

/** One run's drift measurement: recent-window mean against the run mean. */
export type RunDriftMeasurement = {
  readonly sampleCount: number;
  readonly expectedMean: number;
  readonly observedMean: number;
  readonly deviationSigma: number;
};

/**
 * Measure drift over one run's entropy scores with {@link computeCalibration}'s
 * formula: mean and stddev over all scores, observed mean over the trailing
 * min(5, max(3, n)) scores. Pure.
 */
export function measureRunDrift(scores: readonly number[]): RunDriftMeasurement {
  const n = scores.length;
  if (n === 0) return { sampleCount: 0, expectedMean: 0, observedMean: 0, deviationSigma: 0 };
  const mean = scores.reduce((s, v) => s + v, 0) / n;
  const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const recentScores = scores.slice(-Math.min(5, Math.max(3, n)));
  const observedMean = recentScores.reduce((s, v) => s + v, 0) / recentScores.length;
  // Flat scores leave float residue (stddev ~1e-17), which would turn rounding
  // error into a huge sigma; treat it as no spread at all.
  const deviationSigma = stddev > 1e-9 ? (observedMean - mean) / stddev : 0;
  return { sampleCount: n, expectedMean: mean, observedMean, deviationSigma };
}

/**
 * True when a run's drift measurement is real drift: enough scores
 * ({@link CALIBRATION_DRIFT_MIN_SAMPLES}) and a recent mean at least
 * {@link CALIBRATION_DRIFT_MIN_SIGMA} above the run mean. A short or flat run
 * (0σ, expected == observed) never qualifies.
 */
export function isMeaningfulDrift(m: RunDriftMeasurement): boolean {
  return m.sampleCount >= CALIBRATION_DRIFT_MIN_SAMPLES && m.deviationSigma >= CALIBRATION_DRIFT_MIN_SIGMA;
}
