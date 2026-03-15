import type { ControllerDecision, ControllerEvalParams } from "../types.js";

/**
 * Evaluate whether the agent should early-stop based on entropy trajectory.
 * Fires when trajectory has been "converging" for convergenceCount consecutive
 * iterations and latest composite is at or below convergenceThreshold.
 */
export function evaluateEarlyStop(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "early-stop" }) | null {
  const { entropyHistory, config, calibration, iteration, maxIterations } = params;
  const convergenceCount = config.earlyStopConvergenceCount ?? 2;

  // Need enough history and must be past iteration 1 (too early to stop)
  if (entropyHistory.length < convergenceCount || iteration < 2) return null;

  // Check last N entries are all "converging"
  const recent = entropyHistory.slice(-convergenceCount);
  const allConverging = recent.every((e) => e.trajectory.shape === "converging");
  if (!allConverging) return null;

  // Check latest composite is at or below convergence threshold
  const latest = entropyHistory[entropyHistory.length - 1]!;
  if (latest.composite > calibration.convergenceThreshold) return null;

  return {
    decision: "early-stop",
    reason: `Entropy converging for ${convergenceCount} iterations (composite: ${latest.composite.toFixed(3)}, threshold: ${calibration.convergenceThreshold})`,
    iterationsSaved: maxIterations - iteration,
  };
}
