import type { ControllerDecision, ControllerEvalParams } from "../../types.js";

/** Fire when bandit suggests a better prompt variant. Currently a placeholder. */
export function evaluatePromptSwitch(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "prompt-switch" }) | null {
  // Prompt switching requires the bandit to have selected a different variant.
  // This is wired from the LearningEngine — for now, this evaluator checks
  // if the entropy has been flat for many iterations (suggesting the current prompt isn't working).
  const { entropyHistory, activePromptVariantId } = params;
  if (!activePromptVariantId) return null;
  if (entropyHistory.length < 5) return null;

  const recent = entropyHistory.slice(-4);
  const allFlat = recent.every((e) => e.trajectory.shape === "flat");
  if (!allFlat) return null;

  return {
    decision: "prompt-switch",
    fromVariant: activePromptVariantId,
    toVariant: "default", // Bandit will provide the actual variant in the full wiring
    reason: "Flat trajectory for 4+ iterations — current prompt variant may be suboptimal",
  };
}
