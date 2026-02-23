/**
 * Capability matcher — score and rank agents by skill/tag/mode requirements.
 */
import type { AgentCard, AgentSkill } from "../types.js";

export interface MatchResult {
  agent: AgentCard;
  score: number;
  matchedSkills: AgentSkill[];
}

export const matchCapabilities = (
  agents: AgentCard[],
  requirements: { tags?: string[]; skillIds?: string[]; inputModes?: string[] },
): MatchResult[] => {
  return agents
    .map((agent) => {
      let score = 0;
      const matchedSkills: AgentSkill[] = [];

      for (const skill of agent.skills ?? []) {
        // Match by skill ID
        if (requirements.skillIds?.includes(skill.id)) {
          score += 10;
          matchedSkills.push(skill);
        }
        // Match by tags
        if (requirements.tags) {
          const tagMatches = (skill.tags ?? []).filter((t) => requirements.tags!.includes(t)).length;
          score += tagMatches * 5;
          if (tagMatches > 0) matchedSkills.push(skill);
        }
      }

      // Match by input modes
      if (requirements.inputModes) {
        const modeMatches = (agent.defaultInputModes ?? []).filter((m) =>
          requirements.inputModes!.includes(m),
        ).length;
        score += modeMatches * 2;
      }

      return { agent, score, matchedSkills };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
};

export const findBestAgent = (
  agents: AgentCard[],
  requirements: { tags?: string[]; skillIds?: string[]; inputModes?: string[] },
): MatchResult | undefined => {
  const results = matchCapabilities(agents, requirements);
  return results[0];
};
