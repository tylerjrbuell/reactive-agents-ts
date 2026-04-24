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
  if (allConverging) {
    // Check latest composite is at or below convergence threshold
    const latest = entropyHistory[entropyHistory.length - 1]!;
    if (latest.composite <= calibration.convergenceThreshold) {
      return {
        decision: "early-stop",
        reason: `Entropy converging for ${convergenceCount} iterations (composite: ${latest.composite.toFixed(3)}, threshold: ${calibration.convergenceThreshold})`,
        iterationsSaved: maxIterations - iteration,
      };
    }
  }

  // Overflow guard: fire early-stop when approaching maxIterations regardless of trajectory.
  // Catches non-converging runaway loops as a safety net.
  const iterationsBeforeMax = config.earlyStopIterationsBeforeMax ?? 2;
  if (maxIterations > 0 && iteration >= maxIterations - iterationsBeforeMax) {
    return {
      decision: "early-stop",
      reason: `Approaching maxIterations (iter=${iteration}, max=${maxIterations})`,
      iterationsSaved: Math.max(0, maxIterations - iteration),
    };
  }

  return null;
}
