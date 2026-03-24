import type { ControllerDecision, ControllerEvalParams } from "../../types.js";

/** Re-inject skill content when compaction removed it. */
export function evaluateSkillReinject(
  params: ControllerEvalParams,
): (ControllerDecision & { decision: "skill-reinject" }) | null {
  const { contextHasSkillContent, activeSkillNames } = params;
  if (contextHasSkillContent !== false) return null; // only fire when skill content is missing
  if (!activeSkillNames || activeSkillNames.length === 0) return null;

  return {
    decision: "skill-reinject",
    skillName: activeSkillNames[0]!, // Re-inject first active skill
    reason: "Context compaction removed skill content — re-injecting",
  };
}
