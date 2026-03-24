import { describe, it, expect } from "bun:test";
import {
  injectSkill,
  sortByEvictionPriority,
  isSkillContent,
  extractSkillNames,
  SKILL_TIER_BUDGETS,
} from "../../src/skills/skill-injection.js";
import type { SkillRecord, SkillFragmentConfig } from "@reactive-agents/core";

const defaultConfig: SkillFragmentConfig = { strategy: "reactive", temperature: 0.7, maxIterations: 5, promptTemplateId: "default", systemPromptTokens: 0, compressionEnabled: false };

const makeSkill = (overrides: Partial<SkillRecord> = {}): SkillRecord => ({
  id: "skill-1", name: "test-skill", description: "test", agentId: "agent-1", source: "learned",
  instructions: "# Steps\n1. Do thing one.\n2. Do thing two.\n\n## Examples\nExample code here.\n\n## References\nSee docs.",
  version: 1, versionHistory: [], config: defaultConfig, evolutionMode: "auto", confidence: "trusted",
  successRate: 0.8, useCount: 10, refinementCount: 0, taskCategories: ["coding"], modelAffinities: [],
  base: null, avgPostActivationEntropyDelta: 0, avgConvergenceIteration: 0, convergenceSpeedTrend: [],
  conflictsWith: [], lastActivatedAt: null, lastRefinedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
  contentVariants: { full: "# Steps\n1. Do thing one.\n2. Do thing two.\n\n## Examples\nExample code here.\n\n## References\nSee docs.", summary: "Do thing one, then thing two.", condensed: "Do things." },
  ...overrides,
});

describe("injectSkill", () => {
  it("injects at full verbosity when budget allows", () => {
    const result = injectSkill(makeSkill(), "frontier", 10000, 128000);
    expect(result.injected).toBe(true);
    expect(result.verbosity).toBe("full");
    expect(result.content).toContain("<skill_content");
    expect(result.content).toContain("# Steps");
  });

  it("degrades to summary when full doesn't fit", () => {
    // Large tier with tight budget
    const skill = makeSkill({ contentVariants: { full: "x".repeat(5000), summary: "short summary", condensed: "condensed" } });
    const result = injectSkill(skill, "large", 200, 32000); // very tight budget
    expect(result.injected).toBe(true);
    expect(result.verbosity).toBe("summary");
  });

  it("skips when no headroom", () => {
    const result = injectSkill(makeSkill(), "local", 0, 4000);
    expect(result.injected).toBe(false);
    expect(result.skipped).toBe(true);
  });

  it("wraps content in <skill_content> XML", () => {
    const result = injectSkill(makeSkill({ name: "my-skill", version: 3, source: "installed" }), "frontier", 10000, 128000);
    expect(result.content).toContain('name="my-skill"');
    expect(result.content).toContain('version="3"');
    expect(result.content).toContain('source="installed"');
    expect(result.content).toContain("</skill_content>");
  });

  it("falls back to compression when pre-generated variants are null", () => {
    const skill = makeSkill({ contentVariants: { full: "# Steps\n1. Do one.\n\n## Examples\nCode here.", summary: null, condensed: null } });
    // mid tier defaults to summary mode
    const result = injectSkill(skill, "mid", 5000, 32000);
    expect(result.injected).toBe(true);
    // Should have compressed (stripped examples)
    expect(result.content).not.toContain("Examples");
  });
});

describe("sortByEvictionPriority", () => {
  it("evicts tentative skills first", () => {
    const skills = [
      makeSkill({ name: "expert-skill", confidence: "expert" }),
      makeSkill({ name: "tentative-skill", confidence: "tentative" }),
      makeSkill({ name: "trusted-skill", confidence: "trusted" }),
    ];
    const sorted = sortByEvictionPriority(skills, new Set());
    expect(sorted[0]!.name).toBe("tentative-skill");
    expect(sorted[sorted.length - 1]!.name).toBe("expert-skill");
  });

  it("referenced skills ranked higher than unreferenced", () => {
    const skills = [
      makeSkill({ name: "unreferenced", confidence: "trusted" }),
      makeSkill({ name: "referenced", confidence: "trusted" }),
    ];
    const sorted = sortByEvictionPriority(skills, new Set(["referenced"]));
    expect(sorted[0]!.name).toBe("unreferenced");
    expect(sorted[1]!.name).toBe("referenced");
  });
});

describe("isSkillContent", () => {
  it("detects skill_content XML", () => {
    expect(isSkillContent('<skill_content name="x">body</skill_content>')).toBe(true);
  });

  it("rejects non-skill content", () => {
    expect(isSkillContent("regular text")).toBe(false);
  });
});

describe("extractSkillNames", () => {
  it("extracts skill names from XML", () => {
    const content = '<skill_content name="skill-a" version="1" source="learned">\nbody\n</skill_content>\n<skill_content name="skill-b" version="2" source="installed">\nbody2\n</skill_content>';
    expect(extractSkillNames(content)).toEqual(["skill-a", "skill-b"]);
  });

  it("returns empty array for no skill content", () => {
    expect(extractSkillNames("regular text")).toEqual([]);
  });
});

describe("SKILL_TIER_BUDGETS", () => {
  it("has correct tier configurations", () => {
    expect(SKILL_TIER_BUDGETS.local!.budgetTokens).toBe(512);
    expect(SKILL_TIER_BUDGETS.frontier!.budgetTokens).toBe(8000);
    expect(SKILL_TIER_BUDGETS.mid!.defaultVerbosity).toBe("summary");
  });
});
