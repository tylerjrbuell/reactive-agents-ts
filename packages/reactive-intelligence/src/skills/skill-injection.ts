import type { SkillRecord, SkillVerbosityMode } from "@reactive-agents/core";
import { compressSkillContent, estimateTokens } from "./skill-compression.js";

// ─── Constants ───

/** Default safety margin: 10% of model context limit. */
const DEFAULT_SAFETY_MARGIN_PCT = 0.1;

/** Skill tier budgets — soft limits for skill content allocation. */
export const SKILL_TIER_BUDGETS: Record<string, { budgetTokens: number; maxActiveSkills: number; defaultVerbosity: SkillVerbosityMode }> = {
  local: { budgetTokens: 512, maxActiveSkills: 2, defaultVerbosity: "condensed" },
  mid: { budgetTokens: 1500, maxActiveSkills: 3, defaultVerbosity: "summary" },
  large: { budgetTokens: 4000, maxActiveSkills: 5, defaultVerbosity: "full" },
  frontier: { budgetTokens: 8000, maxActiveSkills: 10, defaultVerbosity: "full" },
};

// ─── Injection Guard ───

export type InjectionResult = {
  readonly injected: boolean;
  readonly content: string;       // XML content to inject, or empty if skipped
  readonly verbosity: SkillVerbosityMode;
  readonly tokensUsed: number;
  readonly skipped: boolean;
  readonly skipReason?: string;
};

/**
 * Determine if and how a skill should be injected into context.
 * Tries the tier's default verbosity first, then degrades through lower modes.
 */
export function injectSkill(
  skill: SkillRecord,
  modelTier: string,
  remainingTokens: number,
  modelContextLimit: number,
): InjectionResult {
  const budget = SKILL_TIER_BUDGETS[modelTier] ?? SKILL_TIER_BUDGETS.mid!;
  // Cap safety margin so it never exceeds 20% of remaining tokens — avoids blocking
  // injection when remaining is small relative to the full context limit.
  const rawMargin = Math.floor(modelContextLimit * DEFAULT_SAFETY_MARGIN_PCT);
  const safetyMargin = Math.min(rawMargin, Math.floor(remainingTokens * 0.2));
  const availableTokens = remainingTokens - safetyMargin;

  if (availableTokens <= 0) {
    return { injected: false, content: "", verbosity: "catalog-only", tokensUsed: 0, skipped: true, skipReason: "no context headroom" };
  }

  // Try verbosity modes in order: full → summary → condensed → catalog-only
  const modes: SkillVerbosityMode[] = ["full", "summary", "condensed", "catalog-only"];
  const startIdx = modes.indexOf(budget.defaultVerbosity);

  for (let i = Math.max(0, startIdx); i < modes.length; i++) {
    const mode = modes[i]!;
    if (mode === "catalog-only") {
      return { injected: false, content: "", verbosity: "catalog-only", tokensUsed: 0, skipped: true, skipReason: "context too tight for any content" };
    }

    const content = getContentForVerbosity(skill, mode);
    const tokens = estimateTokens(content);

    if (tokens <= availableTokens) {
      const xml = wrapSkillContent(skill, content);
      return { injected: true, content: xml, verbosity: mode, tokensUsed: tokens, skipped: false };
    }
  }

  return { injected: false, content: "", verbosity: "catalog-only", tokensUsed: 0, skipped: true, skipReason: "skill too large for available context" };
}

/**
 * Get content for a specific verbosity mode.
 */
function getContentForVerbosity(skill: SkillRecord, mode: SkillVerbosityMode): string {
  switch (mode) {
    case "full":
      return skill.contentVariants.full;
    case "summary":
      return skill.contentVariants.summary ?? compressSkillContent(skill.contentVariants.full, 2);
    case "condensed":
      return skill.contentVariants.condensed ?? compressSkillContent(skill.contentVariants.full, 4);
    case "catalog-only":
      return "";
  }
}

/**
 * Wrap content in <skill_content> XML for compaction protection.
 */
function wrapSkillContent(skill: SkillRecord, content: string): string {
  return `<skill_content name="${skill.name}" version="${skill.version}" source="${skill.source}">\n\n${content}\n\n</skill_content>`;
}

// ─── Eviction Priority ───

/**
 * Sort skills by eviction priority (lowest priority evicted first).
 * Order: tentative → unreferenced → summary-mode → trusted → expert (last).
 */
export function sortByEvictionPriority(
  skills: readonly SkillRecord[],
  referencedNames: ReadonlySet<string>,
): SkillRecord[] {
  return [...skills].sort((a, b) => {
    const scoreA = evictionScore(a, referencedNames);
    const scoreB = evictionScore(b, referencedNames);
    return scoreA - scoreB; // lower score = evicted first
  });
}

function evictionScore(skill: SkillRecord, referenced: ReadonlySet<string>): number {
  let score = 0;

  // Confidence tier
  switch (skill.confidence) {
    case "tentative": score += 0; break;
    case "trusted": score += 20; break;
    case "expert": score += 40; break;
  }

  // Referenced in recent iterations
  if (referenced.has(skill.name)) score += 10;

  // Success rate contributes (0-5 points)
  score += Math.floor(skill.successRate * 5);

  return score;
}

// ─── Compaction Protection ───

/**
 * Check if a content block contains skill_content XML tags.
 * Used by compaction services to identify protected blocks.
 */
export function isSkillContent(content: string): boolean {
  return content.includes("<skill_content") && content.includes("</skill_content>");
}

/**
 * Extract skill names from skill_content XML blocks in a context string.
 */
export function extractSkillNames(content: string): string[] {
  const matches = content.matchAll(/<skill_content name="([^"]+)"/g);
  return [...matches].map(m => m[1]!);
}
