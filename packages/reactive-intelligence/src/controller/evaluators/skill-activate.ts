import type { ControllerDecision, ControllerEvalParams } from "../../types.js";

/** Fire when entropy pattern matches a high-confidence available skill. */
export function evaluateSkillActivate(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "skill-activate" }) | null {
  const { availableSkills, activeSkillNames, entropyHistory } = params;
  if (!availableSkills || availableSkills.length === 0) return null;
  if (entropyHistory.length < 2) return null;

  const latest = entropyHistory[entropyHistory.length - 1]!;
  // Only suggest if entropy is elevated (agent struggling)
  if (latest.composite < 0.5) return null;

  // Find a trusted/expert skill not already active
  const activeSet = new Set(activeSkillNames ?? []);
  const candidate = availableSkills.find(
    (s) => (s.confidence === "trusted" || s.confidence === "expert") && !activeSet.has(s.name),
  );

  if (!candidate) return null;

  return {
    decision: "skill-activate",
    skillName: candidate.name,
    trigger: "entropy-match",
    confidence: candidate.confidence,
  };
}
