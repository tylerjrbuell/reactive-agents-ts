import type { ControllerDecision, ControllerEvalParams } from "../types.js";

/**
 * Evaluate whether the agent should early-stop based on entropy trajectory.
 * Fires when trajectory has been "converging" for convergenceCount consecutive
 * iterations and latest composite is at or below convergenceThreshold.
 *
 * Empty-run invariant (FM-A3 backstop, 2026-05-25):
 * Suppresses early-stop on either branch when `hasUserOutput === false` AND
 * the agent isn't at the last allowed iteration. Otherwise an empty
 * `state.output` would terminate the run with a useless
 * `status="failure", error="Reasoning failed"`. Last-iteration early-stop is
 * still allowed because the agent is out of budget regardless.
 */
export function evaluateEarlyStop(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "early-stop" }) | null {
  const { entropyHistory, config, calibration, iteration, maxIterations, hasUserOutput, phase } = params;
  const convergenceCount = config.earlyStopConvergenceCount ?? 2;

  // E2 (audit 02-#5 / H6 generalized): never early-stop during the SYNTHESIZE
  // endgame. H6 already blocked the overflow-guard branch when the entropy shape
  // showed active work; the phase generalizes that to ANY early-stop branch —
  // once the run is composing its answer, confiscating the last iterations
  // discards exactly the deliverable a long-horizon run exists to produce. The
  // `phase` field is supplied ONLY under the long-horizon profile, so absent it
  // this guard is inert and prior behavior is byte-identical.
  if (phase === "synthesize") return null;

  // Empty-run invariant — applies to BOTH branches below.
  // Permissive default: when caller omits the flag, treat as `true` so outer-loop
  // synthetic evaluators (plan-execute, ToT) that don't plumb state.output keep
  // their current behavior.
  const atLastIteration = maxIterations > 0 && iteration >= maxIterations - 1;
  const suppressForEmptyOutput = hasUserOutput === false && !atLastIteration;

  // Need enough history and must be past iteration 1 (too early to stop)
  if (entropyHistory.length < convergenceCount || iteration < 2) return null;

  // Check last N entries are all "converging"
  const recent = entropyHistory.slice(-convergenceCount);
  const allConverging = recent.every((e) => e.trajectory.shape === "converging");
  if (allConverging) {
    // Check latest composite is at or below convergence threshold
    const latest = entropyHistory[entropyHistory.length - 1]!;
    if (latest.composite <= calibration.convergenceThreshold) {
      if (suppressForEmptyOutput) return null;
      return {
        decision: "early-stop",
        reason: `Entropy converging for ${convergenceCount} iterations (composite: ${latest.composite.toFixed(3)}, threshold: ${calibration.convergenceThreshold})`,
        iterationsSaved: maxIterations - iteration,
      };
    }
  }

  // Overflow guard: fire early-stop when approaching maxIterations — a safety
  // net for runs that are SPINNING near the budget ceiling.
  //
  // H6 (2026-07-08 sweep, audit 02-#5): this used to fire unconditionally,
  // amputating the final `iterationsBeforeMax` iterations of EVERY run with
  // output — confiscating exactly the synthesis endgame a long-horizon run
  // needs (the hard max_iterations stop already exists one step later, so the
  // unconditional form only ever saved ~2 iterations while risking the
  // deliverable). It now fires only when the latest entropy trajectory shows
  // no new ground being covered (flat / oscillating / converging). A run whose
  // trajectory is diverging or v-recovering near the ceiling is actively
  // working — let it spend its last iterations and hit max_iterations
  // naturally.
  const iterationsBeforeMax = config.earlyStopIterationsBeforeMax ?? 2;
  if (maxIterations > 0 && iteration >= maxIterations - iterationsBeforeMax) {
    if (suppressForEmptyOutput) return null;
    const latestShape = entropyHistory[entropyHistory.length - 1]?.trajectory.shape;
    const spinning =
      latestShape === "flat" || latestShape === "oscillating" || latestShape === "converging";
    if (!spinning) return null;
    return {
      decision: "early-stop",
      reason: `Approaching maxIterations (iter=${iteration}, max=${maxIterations}) with ${latestShape} trajectory`,
      iterationsSaved: Math.max(0, maxIterations - iteration),
    };
  }

  return null;
}
