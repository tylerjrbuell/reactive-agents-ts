/**
 * Skill types for the Living Skills System.
 * These types live in core to avoid circular dependencies with reactive-intelligence.
 */

/** Config recipe — how to run this skill (automated updates from run outcomes). */
export type SkillFragmentConfig = {
  readonly strategy: string;
  readonly temperature: number;
  readonly maxIterations: number;
  readonly promptTemplateId: string;
  readonly systemPromptTokens: number;
  readonly compressionEnabled: boolean;
};

/** Origin of a skill: learned from execution, installed from filesystem, or promoted from another agent. */
export type SkillSource = "learned" | "installed" | "promoted";

/** Confidence tier for a skill based on observed success rate. */
export type SkillConfidence = "tentative" | "trusted" | "expert";

/** How the skill is allowed to evolve over time. */
export type SkillEvolutionMode = "auto" | "suggest" | "locked";

/** How a skill's content is presented in context based on available token budget. */
export type SkillVerbosityMode = "full" | "summary" | "condensed" | "catalog-only";

/** A historical snapshot of a skill at a specific version. */
export type SkillVersion = {
  readonly version: number;
  readonly instructions: string;
  readonly config: SkillFragmentConfig;
  readonly refinedAt: Date;
  readonly successRateAtRefinement: number;
  readonly status: "candidate" | "active";
};

/** Full skill record persisted in SkillStore. */
export type SkillRecord = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly agentId: string;
  readonly source: SkillSource;
  readonly instructions: string;
  readonly version: number;
  readonly versionHistory: readonly SkillVersion[];
  readonly config: SkillFragmentConfig;
  readonly evolutionMode: SkillEvolutionMode;
  readonly confidence: SkillConfidence;
  readonly successRate: number;
  readonly useCount: number;
  readonly refinementCount: number;
  readonly taskCategories: readonly string[];
  readonly modelAffinities: readonly string[];
  readonly base: string | null;
  readonly avgPostActivationEntropyDelta: number;
  readonly avgConvergenceIteration: number;
  readonly convergenceSpeedTrend: readonly number[];
  readonly conflictsWith: readonly string[];
  readonly lastActivatedAt: Date | null;
  readonly lastRefinedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly contentVariants: {
    readonly full: string;
    readonly summary: string | null;
    readonly condensed: string | null;
  };
};

/** Token budget and skill limits per model tier. */
export type SkillTierBudget = {
  readonly tier: string;
  readonly budgetTokens: number;
  readonly maxActiveSkills: number;
  readonly defaultVerbosity: SkillVerbosityMode;
};
