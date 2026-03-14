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
