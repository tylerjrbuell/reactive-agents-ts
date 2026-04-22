import type { ControllerDecision, ControllerEvalParams } from "../../types.js";

const FLAT_ENTROPY_THRESHOLD = 0.20;
const STALL_WINDOW_BY_TIER: Record<string, number> = {
  local: 2,
  mid: 3,
  large: 4,
  frontier: 5,
};

/**
 * Detect stalls: all recent entropy values flat near baseline AND no consecutive
 * tool failures (those are handled by tool-failure-streak).
 *
 * Uses entropy history as a proxy for content-level repetition — when a local
 * model's composite entropy stays at ~0.150 across 2+ iterations with no new
 * tool calls, the model is repeating without progress.
 */
export function evaluateStallDetect(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "stall-detect" }) | null {
  const { entropyHistory, iteration, priorDecisionsThisRun = [], consecutiveToolFailures } = params;

  // Don't overlap with tool-failure-streak — that handler covers repeated tool errors
  if (consecutiveToolFailures && consecutiveToolFailures >= 2) return null;

  // Need enough history to judge
  const tier = "local"; // conservative default — actual tier not in params yet
  const window = STALL_WINDOW_BY_TIER[tier] ?? 3;
  if (iteration < window) return null;

  // Check if all recent entropy values are flat near the baseline
  const recent = entropyHistory.slice(-window);
  if (recent.length < window) return null;
  const allFlat = recent.every((e) => e.composite <= FLAT_ENTROPY_THRESHOLD);
  if (!allFlat) return null;

  // Don't fire twice in quick succession — let the nudge have a chance to work
  const priorStalls = priorDecisionsThisRun.filter((d) => d.startsWith("stall-detect")).length;
  if (priorStalls >= 2) return null;

  const stalledIterations = recent.length;
  return {
    decision: "stall-detect",
    stalledIterations,
    reason: `Entropy flat at ≤${FLAT_ENTROPY_THRESHOLD} for ${stalledIterations} consecutive iterations — model appears stuck`,
  };
}
