// Run: bun test packages/reactive-intelligence/tests/learning/skill-fragment-to-skill-record.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { skillFragmentToSkillRecord } from "../../src/learning/skill-synthesis.js";

const testFragment = {
  promptTemplateId: "default",
  systemPromptTokens: 128,
  contextStrategy: {
    compressionEnabled: true,
    maxIterations: 8,
    temperature: 0.6,
    toolFilteringMode: "adaptive" as const,
    requiredToolsCount: 2,
  },
  memoryConfig: {
    tier: "enhanced",
    semanticLines: 5,
    episodicLines: 10,
    consolidationEnabled: true,
  },
  reasoningConfig: {
    strategy: "plan-execute-reflect",
    strategySwitchingEnabled: true,
    adaptiveEnabled: true,
  },
  convergenceIteration: 3,
  finalComposite: 0.18,
  meanComposite: 0.28,
};

describe("skillFragmentToSkillRecord", () => {
  it("returns a SkillRecord with source=learned and confidence=tentative", () => {
    const record = skillFragmentToSkillRecord({
      fragment: testFragment,
      agentId: "agent-123",
      taskCategory: "code-generation",
      modelId: "claude-sonnet-4",
    });

    expect(record.source).toBe("learned");
    expect(record.confidence).toBe("tentative");
    expect(record.evolutionMode).toBe("auto");
  }, 15000);

  it("sets name and taskCategories from taskCategory param", () => {
    const record = skillFragmentToSkillRecord({
      fragment: testFragment,
      agentId: "agent-123",
      taskCategory: "code-generation",
      modelId: "claude-sonnet-4",
    });

    expect(record.name).toBe("code-generation:claude-sonnet-4");
    expect(record.taskCategories).toContain("code-generation");
    expect(record.modelAffinities).toContain("claude-sonnet-4");
  }, 15000);

  it("maps SkillFragmentConfig correctly", () => {
    const record = skillFragmentToSkillRecord({
      fragment: testFragment,
      agentId: "agent-123",
      taskCategory: "code-generation",
      modelId: "claude-sonnet-4",
    });

    expect(record.config.strategy).toBe("plan-execute-reflect");
    expect(record.config.temperature).toBe(0.6);
    expect(record.config.maxIterations).toBe(8);
    expect(record.config.promptTemplateId).toBe("default");
    expect(record.config.systemPromptTokens).toBe(128);
    expect(record.config.compressionEnabled).toBe(true);
  }, 15000);

  it("generates instructions text that describes the learned config", () => {
    const record = skillFragmentToSkillRecord({
      fragment: testFragment,
      agentId: "agent-123",
      taskCategory: "code-generation",
      modelId: "claude-sonnet-4",
    });

    expect(record.instructions).toContain("plan-execute-reflect");
    expect(record.instructions).toContain("code-generation");
    expect(record.instructions).toContain("claude-sonnet-4");
    expect(record.instructions).toContain("0.6");  // temperature
  }, 15000);

  it("sets contentVariants.full to instructions and summary/condensed to null", () => {
    const record = skillFragmentToSkillRecord({
      fragment: testFragment,
      agentId: "agent-123",
      taskCategory: "code-generation",
      modelId: "claude-sonnet-4",
    });

    expect(record.contentVariants.full).toBe(record.instructions);
    expect(record.contentVariants.summary).toBeNull();
    expect(record.contentVariants.condensed).toBeNull();
  }, 15000);

  it("sets avgConvergenceIteration from fragment.convergenceIteration", () => {
    const record = skillFragmentToSkillRecord({
      fragment: testFragment,
      agentId: "agent-123",
      taskCategory: "code-generation",
      modelId: "claude-sonnet-4",
    });

    expect(record.avgConvergenceIteration).toBe(3);
  }, 15000);

  it("uses 0 for avgConvergenceIteration when convergenceIteration is null", () => {
    const record = skillFragmentToSkillRecord({
      fragment: { ...testFragment, convergenceIteration: null },
      agentId: "agent-123",
      taskCategory: "code-generation",
      modelId: "claude-sonnet-4",
    });

    expect(record.avgConvergenceIteration).toBe(0);
  }, 15000);

  it("starts with useCount=0, successRate=1.0, refinementCount=0", () => {
    const record = skillFragmentToSkillRecord({
      fragment: testFragment,
      agentId: "agent-123",
      taskCategory: "code-generation",
      modelId: "claude-sonnet-4",
    });

    expect(record.useCount).toBe(0);
    expect(record.successRate).toBe(1.0);
    expect(record.refinementCount).toBe(0);
  }, 15000);

  it("generates a valid UUID as id", () => {
    const record = skillFragmentToSkillRecord({
      fragment: testFragment,
      agentId: "agent-123",
      taskCategory: "code-generation",
      modelId: "claude-sonnet-4",
    });

    expect(record.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  }, 15000);
});
