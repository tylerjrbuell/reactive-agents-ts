import { describe, test, expect } from "bun:test";
import type {
  SkillRecord,
  SkillVersion,
  SkillVerbosityMode,
  SkillSource,
  SkillConfidence,
  SkillEvolutionMode,
  SkillTierBudget,
  SkillFragmentConfig,
} from "../skill.js";

describe("Skill types", () => {
  test("SkillRecord can be constructed with all required fields", () => {
    const record: SkillRecord = {
      id: "skill-1",
      name: "data-analysis",
      description: "Analyze data sets",
      agentId: "agent-1",
      source: "learned",
      instructions: "# Steps\n1. Load data\n2. Analyze",
      version: 1,
      versionHistory: [],
      config: { strategy: "reactive", temperature: 0.7, maxIterations: 5, promptTemplateId: "default", systemPromptTokens: 0, compressionEnabled: false },
      evolutionMode: "auto",
      confidence: "tentative",
      successRate: 0,
      useCount: 0,
      refinementCount: 0,
      taskCategories: ["coding"],
      modelAffinities: ["claude-sonnet-4"],
      base: null,
      avgPostActivationEntropyDelta: 0,
      avgConvergenceIteration: 0,
      convergenceSpeedTrend: [],
      conflictsWith: [],
      lastActivatedAt: null,
      lastRefinedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      contentVariants: { full: "# Steps\n1. Load data\n2. Analyze", summary: null, condensed: null },
    };
    expect(record.name).toBe("data-analysis");
    expect(record.confidence).toBe("tentative");
    expect(record.source).toBe("learned");
  });

  test("SkillVersion tracks candidate/active status", () => {
    const version: SkillVersion = {
      version: 2,
      instructions: "Updated instructions",
      config: { strategy: "plan-execute-reflect", temperature: 0.5, maxIterations: 4, promptTemplateId: "default", systemPromptTokens: 0, compressionEnabled: false },
      refinedAt: new Date(),
      successRateAtRefinement: 0.85,
      status: "candidate",
    };
    expect(version.status).toBe("candidate");
    expect(version.version).toBe(2);
  });

  test("SkillVerbosityMode includes all 4 modes", () => {
    const modes: SkillVerbosityMode[] = ["full", "summary", "condensed", "catalog-only"];
    expect(modes).toHaveLength(4);
  });

  test("SkillSource covers all 3 origins", () => {
    const sources: SkillSource[] = ["learned", "installed", "promoted"];
    expect(sources).toHaveLength(3);
  });

  test("SkillConfidence covers all 3 tiers", () => {
    const tiers: SkillConfidence[] = ["tentative", "trusted", "expert"];
    expect(tiers).toHaveLength(3);
  });

  test("SkillEvolutionMode covers all 3 modes", () => {
    const modes: SkillEvolutionMode[] = ["auto", "suggest", "locked"];
    expect(modes).toHaveLength(3);
  });

  test("SkillTierBudget has correct shape", () => {
    const budget: SkillTierBudget = { tier: "frontier", budgetTokens: 8000, maxActiveSkills: 10, defaultVerbosity: "full" };
    expect(budget.tier).toBe("frontier");
    expect(budget.budgetTokens).toBe(8000);
  });
});
