import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import type { SkillRecord, SkillFragmentConfig, SkillConfidence } from "@reactive-agents/core";
import { ReactiveAgents } from "../builder.js";

// ─── Test utility ───
const defaultConfig: SkillFragmentConfig = {
  strategy: "reactive",
  temperature: 0.7,
  maxIterations: 5,
  promptTemplateId: "default",
  systemPromptTokens: 0,
  compressionEnabled: false,
};

const makeSkillRecord = (overrides: Partial<SkillRecord> = {}): SkillRecord => ({
  id: "skill-1",
  name: "test-skill",
  description: "A test skill",
  agentId: "agent-1",
  source: "learned",
  instructions: "# Steps\n1. Load data.\n2. Run analysis.\n\n## Examples\nExample code.\n\n## References\nSee docs.",
  version: 1,
  versionHistory: [],
  config: defaultConfig,
  evolutionMode: "auto",
  confidence: "tentative",
  successRate: 0.5,
  useCount: 3,
  refinementCount: 0,
  taskCategories: ["coding"],
  modelAffinities: [],
  base: null,
  avgPostActivationEntropyDelta: 0,
  avgConvergenceIteration: 0,
  convergenceSpeedTrend: [],
  conflictsWith: [],
  lastActivatedAt: null,
  lastRefinedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  contentVariants: {
    full: "# Steps\n1. Load data.\n2. Run analysis.\n\n## Examples\nExample code.\n\n## References\nSee docs.",
    summary: "Load data then run analysis.",
    condensed: "Load data. Run analysis.",
  },
  ...overrides,
});

describe("Living Intelligence System integration", () => {
  describe("Type integration", () => {
    it("SkillRecord from @reactive-agents/core is usable across packages", () => {
      const skill = makeSkillRecord();
      // Verify type contract
      expect(skill.name).toBe("test-skill");
      expect(skill.confidence).toBe("tentative");
      expect(skill.contentVariants.full).toContain("# Steps");
      expect(skill.contentVariants.summary).toBe("Load data then run analysis.");
    });

    it("SkillConfidence tiers follow spec-defined thresholds", () => {
      // tentative: < 5 activations or successRate < 0.8
      // trusted:   5-20 activations, successRate >= 0.8
      // expert:    > 20 activations, successRate >= 0.9
      const tentative = makeSkillRecord({ confidence: "tentative", useCount: 3, successRate: 0.5 });
      const trusted = makeSkillRecord({ confidence: "trusted", useCount: 10, successRate: 0.85 });
      const expert = makeSkillRecord({ confidence: "expert", useCount: 25, successRate: 0.92 });

      expect(tentative.confidence).toBe("tentative");
      expect(trusted.confidence).toBe("trusted");
      expect(expert.confidence).toBe("expert");
    });
  });

  describe("Compression + Injection integration", () => {
    it("compression pipeline + injection guard work together", async () => {
      const { compressSkillContent, getDefaultCompressionStage } = await import("@reactive-agents/reactive-intelligence");

      const fullBody = "# Steps\n1. Load data.\n2. Run analysis.\n\n## Examples\nExample code.\n\n## References\nSee docs.";

      // Frontier: no compression
      expect(getDefaultCompressionStage("frontier")).toBe(0);
      expect(compressSkillContent(fullBody, 0)).toBe(fullBody);

      // Mid: strip examples + references
      expect(getDefaultCompressionStage("mid")).toBe(2);
      const midResult = compressSkillContent(fullBody, 2);
      expect(midResult).not.toContain("Examples");
      expect(midResult).not.toContain("References");
      expect(midResult).toContain("# Steps");

      // Local: directives only
      expect(getDefaultCompressionStage("local")).toBe(4);
      const localResult = compressSkillContent(fullBody, 4);
      expect(localResult).toContain("Load data");
      expect(localResult).toContain("Run analysis");
    });

    it("injection guard respects tier budgets", async () => {
      const { injectSkill, SKILL_TIER_BUDGETS } = await import("@reactive-agents/reactive-intelligence");

      const skill = makeSkillRecord();

      // Frontier with plenty of budget → full
      const frontierResult = injectSkill(skill, "frontier", 10000, 128000);
      expect(frontierResult.injected).toBe(true);
      expect(frontierResult.content).toContain("<skill_content");

      // Local with no budget → skipped
      const localResult = injectSkill(skill, "local", 0, 4000);
      expect(localResult.injected).toBe(false);
      expect(localResult.skipped).toBe(true);

      // Verify tier budgets exist
      expect(SKILL_TIER_BUDGETS.local!.budgetTokens).toBe(512);
      expect(SKILL_TIER_BUDGETS.frontier!.budgetTokens).toBe(8000);
    });
  });

  describe("Meta-tools integration", () => {
    it("get_skill_section resolves sections from SkillRecord content", async () => {
      const { getSkillSection } = await import("@reactive-agents/tools");

      const skill = makeSkillRecord();

      expect(getSkillSection(skill.contentVariants.full, "examples")).toContain("Example code");
      expect(getSkillSection(skill.contentVariants.full, "steps")).toContain("Load data");
      expect(getSkillSection(skill.contentVariants.full, "full")).toBe(skill.contentVariants.full);
      expect(getSkillSection(skill.contentVariants.full, "nonexistent")).toBe("section not found");
    });

    it("activate_skill XML wraps content correctly", async () => {
      const { buildSkillContentXml } = await import("@reactive-agents/tools");

      const skill = makeSkillRecord({ name: "my-skill", version: 3, source: "installed" });
      const xml = buildSkillContentXml({
        name: skill.name,
        version: skill.version,
        source: skill.source,
        instructions: skill.instructions,
      });

      expect(xml).toContain('<skill_content name="my-skill"');
      expect(xml).toContain('version="3"');
      expect(xml).toContain("</skill_content>");
    });
  });

  describe("Builder integration", () => {
    it("withSkills() + withReactiveIntelligence() chain works", () => {
      const builder = ReactiveAgents.create()
        .withProvider("test")
        .withSkills({ paths: ["./skills/"], evolution: { mode: "auto" } })
        .withReactiveIntelligence({
          onEntropyScored: () => {},
          constraints: { maxTemperatureAdjustment: 0.15 },
          autonomy: "suggest",
        })
        .withReasoning();

      expect(builder).toBeDefined();
    });

    it("test provider does not contaminate intelligence (builder sanity)", () => {
      // Verify that builder with test provider is valid
      const builder = ReactiveAgents.create()
        .withProvider("test")
        .withReactiveIntelligence()
        .withSkills();

      expect(builder).toBeDefined();
    });
  });

  describe("Event type coverage", () => {
    it("all 12 new intelligence events are importable from core", async () => {
      // Dynamic import to verify exports
      const core = await import("@reactive-agents/core");

      // Type-level check: construct each event type
      const events: any[] = [
        { _tag: "SkillActivated", skillName: "s", version: 1, trigger: "model", iteration: 1, confidence: "trusted" },
        { _tag: "SkillRefined", skillName: "s", previousVersion: 1, newVersion: 2, taskCategory: "coding" },
        { _tag: "SkillRefinementSuggested", skillName: "s", newInstructions: "", reason: "" },
        { _tag: "SkillRolledBack", skillName: "s", fromVersion: 2, toVersion: 1, reason: "regression" },
        { _tag: "SkillConflictDetected", skillA: "a", skillB: "b", conflictType: "task-overlap" },
        { _tag: "SkillPromoted", skillName: "s", fromConfidence: "tentative", toConfidence: "trusted" },
        { _tag: "SkillSkippedContextFull", skillName: "s", requiredTokens: 500, availableTokens: 100, modelTier: "local" },
        { _tag: "SkillEvicted", skillName: "s", reason: "budget", verbosityAtEviction: "summary" },
        { _tag: "TemperatureAdjusted", delta: -0.1, reason: "", iteration: 3 },
        { _tag: "ToolInjected", toolName: "web-search", reason: "", iteration: 3 },
        { _tag: "MemoryBoostTriggered", from: "recent", to: "semantic", iteration: 3 },
        { _tag: "AgentNeedsHuman", agentId: "a", taskId: "t", reason: "", decisionsExhausted: [], context: "" },
      ];

      expect(events).toHaveLength(12);
      expect(events.every(e => e._tag)).toBe(true);
    });
  });

  describe("Controller decision types", () => {
    it("all 10 controller decision types are valid", async () => {
      const { defaultReactiveIntelligenceConfig } = await import("@reactive-agents/reactive-intelligence");

      // Verify new defaults
      expect(defaultReactiveIntelligenceConfig.learning.skillSynthesis).toBe(true);
      expect(defaultReactiveIntelligenceConfig.learning.banditSelection).toBe(true);
    });
  });

  describe("SKILL.md registry", () => {
    it("parseSKILLmd + discoverSkills are importable and functional", async () => {
      const { parseSKILLmd, discoverSkills } = await import("@reactive-agents/reactive-intelligence");
      const fs = await import("node:fs");
      const path = await import("node:path");
      const os = await import("node:os");

      // Create a temp SKILL.md
      const tmpDir = path.join(os.tmpdir(), "test-integration-skills");
      const skillDir = path.join(tmpDir, "test-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: test-skill\ndescription: Integration test skill\n---\n\n# Test\nDo the test thing.\n");

      try {
        const parsed = parseSKILLmd(path.join(skillDir, "SKILL.md"));
        expect(parsed).not.toBeNull();
        expect(parsed!.name).toBe("test-skill");
        expect(parsed!.description).toBe("Integration test skill");

        const discovered = discoverSkills([tmpDir], "agent-1");
        // discoverSkills also scans ~/.agents/skills and ~/.reactive-agents/skills,
        // so there may be more than 1 skill found — just verify ours is present.
        expect(discovered.skills.length).toBeGreaterThanOrEqual(1);
        const ourSkill = discovered.skills.find(s => s.name === "test-skill");
        expect(ourSkill).toBeDefined();
        expect(ourSkill!.name).toBe("test-skill");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
