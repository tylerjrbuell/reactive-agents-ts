import type { EntropyTrajectory, EntropyTrajectoryShape } from "../types.js";

/** Sigmoid function: 1 / (1 + exp(-x)) */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Iteration-position-aware weighting.
 * Low weight early (exploration is normal), high weight late (should be converging).
 */
export function iterationWeight(i: number, maxIter: number): number {
  if (maxIter <= 0) return 0.5;
  return sigmoid((i - maxIter / 2) * (4 / maxIter));
}

/**
 * Classify trajectory shape from an entropy history.
 */
export function classifyTrajectoryShape(history: readonly number[]): EntropyTrajectoryShape {
  if (history.length < 3) return "flat";

  const n = history.length;
  const diffs: number[] = [];
  for (let i = 1; i < n; i++) {
    diffs.push(history[i]! - history[i - 1]!);
  }

  // Check oscillating: alternating sign changes with significant magnitude
  let signChanges = 0;
  for (let i = 1; i < diffs.length; i++) {
    if (diffs[i]! * diffs[i - 1]! < 0 && Math.abs(diffs[i]!) > 0.05 && Math.abs(diffs[i - 1]!) > 0.05) signChanges++;
  }
  if (signChanges >= Math.floor(diffs.length * 0.6) && diffs.length >= 3) {
    return "oscillating";
  }

  // Check v-recovery: drops significantly then rises
  const minIdx = history.indexOf(Math.min(...history));
  if (minIdx > 0 && minIdx < n - 1) {
    const dropBefore = history[0]! - history[minIdx]!;
    const riseAfter = history[n - 1]! - history[minIdx]!;
    if (dropBefore > 0.15 && riseAfter > 0.15) {
      return "v-recovery";
    }
  }

  // Recent slope (last 3 points)
  const recent = history.slice(-3);
  const recentSlope = (recent[recent.length - 1]! - recent[0]!) / (recent.length - 1);

  if (recentSlope < -0.05) return "converging";
  if (recentSlope > 0.05) return "diverging";
  return "flat";
}

/**
 * Compute entropy trajectory from accumulated composite scores.
 */
export function computeEntropyTrajectory(
  history: readonly number[],
  maxIterations: number,
): EntropyTrajectory {
  if (history.length === 0) {
    return { history: [], derivative: 0, momentum: 0, shape: "flat" };
  }

  if (history.length === 1) {
    return { history: [...history], derivative: 0, momentum: history[0]!, shape: "flat" };
  }

  // Derivative: slope of last 3 iterations (or fewer if <3 available)
  const windowSize = Math.min(3, history.length);
  const recentWindow = history.slice(-windowSize);
  const derivative = (recentWindow[recentWindow.length - 1]! - recentWindow[0]!) / (windowSize - 1);

  // Momentum: exponentially weighted moving average (α = 0.3)
  const alpha = 0.3;
  let momentum = history[0]!;
  for (let i = 1; i < history.length; i++) {
    momentum = alpha * history[i]! + (1 - alpha) * momentum;
  }

  const shape = classifyTrajectoryShape(history);

  return {
    history: [...history],
    derivative,
    momentum,
    shape,
  };
}
