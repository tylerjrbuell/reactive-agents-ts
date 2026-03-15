import { describe, test, expect } from "bun:test";
import {
  shouldSynthesizeSkill,
  extractSkillFragment,
} from "../../src/learning/skill-synthesis.js";

describe("shouldSynthesizeSkill", () => {
  const convergingEntry = (composite: number) => ({
    composite,
    trajectory: { shape: "converging" },
  });
  const flatEntry = (composite: number) => ({
    composite,
    trajectory: { shape: "flat" },
  });

  test("returns false for non-success outcome", () => {
    expect(
      shouldSynthesizeSkill({
        entropyHistory: [convergingEntry(0.3)],
        outcome: "failure",
        highEntropyThreshold: 0.8,
      }),
    ).toBe(false);
    expect(
      shouldSynthesizeSkill({
        entropyHistory: [convergingEntry(0.3)],
        outcome: "partial",
        highEntropyThreshold: 0.8,
      }),
    ).toBe(false);
  });

  test("returns false for non-converging trajectory", () => {
    expect(
      shouldSynthesizeSkill({
        entropyHistory: [flatEntry(0.3), flatEntry(0.2)],
        outcome: "success",
        highEntropyThreshold: 0.8,
      }),
    ).toBe(false);
  });

  test("returns false when mean entropy above threshold", () => {
    expect(
      shouldSynthesizeSkill({
        entropyHistory: [convergingEntry(0.9), convergingEntry(0.85)],
        outcome: "success",
        highEntropyThreshold: 0.8,
      }),
    ).toBe(false);
  });

  test("returns true when all conditions met", () => {
    expect(
      shouldSynthesizeSkill({
        entropyHistory: [
          { composite: 0.6, trajectory: { shape: "flat" } },
          { composite: 0.4, trajectory: { shape: "converging" } },
          convergingEntry(0.3),
        ],
        outcome: "success",
        highEntropyThreshold: 0.8,
      }),
    ).toBe(true);
  });
});

describe("extractSkillFragment", () => {
  test("produces valid SkillFragment with correct fields", () => {
    const entropyHistory = [
      { composite: 0.7, trajectory: { shape: "flat" } },
      { composite: 0.5, trajectory: { shape: "converging" } },
      { composite: 0.3, trajectory: { shape: "converging" } },
    ];

    const fragment = extractSkillFragment({
      strategy: "react",
      temperature: 0.7,
      maxIterations: 10,
      toolFilteringMode: "adaptive",
      requiredToolsCount: 3,
      memoryTier: "standard",
      semanticLines: 20,
      episodicLines: 10,
      consolidationEnabled: true,
      strategySwitchingEnabled: false,
      adaptiveEnabled: true,
      entropyHistory,
    });

    expect(fragment.contextStrategy.temperature).toBe(0.7);
    expect(fragment.contextStrategy.maxIterations).toBe(10);
    expect(fragment.contextStrategy.toolFilteringMode).toBe("adaptive");
    expect(fragment.contextStrategy.requiredToolsCount).toBe(3);
    expect(fragment.memoryConfig.tier).toBe("standard");
    expect(fragment.memoryConfig.semanticLines).toBe(20);
    expect(fragment.memoryConfig.episodicLines).toBe(10);
    expect(fragment.memoryConfig.consolidationEnabled).toBe(true);
    expect(fragment.reasoningConfig.strategy).toBe("react");
    expect(fragment.reasoningConfig.strategySwitchingEnabled).toBe(false);
    expect(fragment.reasoningConfig.adaptiveEnabled).toBe(true);
    // Convergence iteration is index 1 (first "converging")
    expect(fragment.convergenceIteration).toBe(1);
    expect(fragment.finalComposite).toBe(0.3);
    expect(fragment.meanComposite).toBeCloseTo(0.5, 5);
  });
});
