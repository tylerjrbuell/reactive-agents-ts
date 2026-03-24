import { describe, it, expect } from "bun:test";
import { extractSkillFragment } from "../../src/learning/skill-synthesis.js";

const baseParams = {
  strategy: "reactive",
  temperature: 0.7,
  maxIterations: 5,
  toolFilteringMode: "adaptive" as const,
  requiredToolsCount: 2,
  memoryTier: "2",
  semanticLines: 10,
  episodicLines: 5,
  consolidationEnabled: true,
  strategySwitchingEnabled: false,
  adaptiveEnabled: false,
  entropyHistory: [
    { composite: 0.5, trajectory: { shape: "flat" } },
    { composite: 0.3, trajectory: { shape: "converging" } },
  ],
};

describe("extractSkillFragment wiring", () => {
  it("promptTemplateId uses promptVariantId when provided", () => {
    const fragment = extractSkillFragment({ ...baseParams, promptVariantId: "variant-A" });
    expect(fragment.promptTemplateId).toBe("variant-A");
  });

  it("promptTemplateId defaults to 'default' when not provided", () => {
    const fragment = extractSkillFragment(baseParams);
    expect(fragment.promptTemplateId).toBe("default");
  });

  it("systemPromptTokens uses provided value", () => {
    const fragment = extractSkillFragment({ ...baseParams, systemPromptTokens: 450 });
    expect(fragment.systemPromptTokens).toBe(450);
  });

  it("systemPromptTokens defaults to 0 when not provided", () => {
    const fragment = extractSkillFragment(baseParams);
    expect(fragment.systemPromptTokens).toBe(0);
  });

  it("compressionEnabled uses provided value", () => {
    const fragment = extractSkillFragment({ ...baseParams, compressionEnabled: true });
    expect(fragment.contextStrategy.compressionEnabled).toBe(true);
  });

  it("compressionEnabled defaults to false when not provided", () => {
    const fragment = extractSkillFragment(baseParams);
    expect(fragment.contextStrategy.compressionEnabled).toBe(false);
  });

  it("all three fields wire correctly together", () => {
    const fragment = extractSkillFragment({
      ...baseParams,
      promptVariantId: "v2",
      systemPromptTokens: 1200,
      compressionEnabled: true,
    });
    expect(fragment.promptTemplateId).toBe("v2");
    expect(fragment.systemPromptTokens).toBe(1200);
    expect(fragment.contextStrategy.compressionEnabled).toBe(true);
  });
});
