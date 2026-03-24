import { describe, it, expect } from "bun:test";
import { evaluateTempAdjust } from "../../src/controller/evaluators/temp-adjust.js";
import { evaluateSkillActivate } from "../../src/controller/evaluators/skill-activate.js";
import { evaluatePromptSwitch } from "../../src/controller/evaluators/prompt-switch.js";
import { evaluateToolInject } from "../../src/controller/evaluators/tool-inject.js";
import { evaluateMemoryBoost } from "../../src/controller/evaluators/memory-boost.js";
import { evaluateSkillReinject } from "../../src/controller/evaluators/skill-reinject.js";
import { evaluateHumanEscalate } from "../../src/controller/evaluators/human-escalate.js";
import type { ControllerEvalParams } from "../../src/types.js";

const baseParams: ControllerEvalParams = {
  entropyHistory: [
    { composite: 0.5, trajectory: { shape: "flat", derivative: 0.01, momentum: 0 } },
    { composite: 0.6, trajectory: { shape: "diverging", derivative: 0.06, momentum: 0.05 } },
    { composite: 0.7, trajectory: { shape: "diverging", derivative: 0.08, momentum: 0.1 } },
    { composite: 0.8, trajectory: { shape: "diverging", derivative: 0.1, momentum: 0.2 } },
  ],
  iteration: 4,
  maxIterations: 10,
  calibration: { convergenceThreshold: 0.3, highEntropyThreshold: 0.7, calibrated: true, sampleCount: 50 },
  config: { earlyStop: true, contextCompression: true, strategySwitch: true },
  contextPressure: 0.6,
  behavioralLoopScore: 0.3,
};

describe("evaluateTempAdjust", () => {
  it("fires when entropy diverges over 3 iterations", () => {
    const result = evaluateTempAdjust({ ...baseParams, currentTemperature: 0.7 });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("temp-adjust");
    expect(result!.delta).toBeLessThan(0);
  });

  it("returns null without currentTemperature", () => {
    expect(evaluateTempAdjust(baseParams)).toBeNull();
  });

  it("returns null with converging trajectory", () => {
    const params = {
      ...baseParams,
      currentTemperature: 0.7,
      entropyHistory: [
        { composite: 0.5, trajectory: { shape: "converging" as const, derivative: -0.1, momentum: -0.1 } },
        { composite: 0.4, trajectory: { shape: "converging" as const, derivative: -0.1, momentum: -0.1 } },
        { composite: 0.3, trajectory: { shape: "converging" as const, derivative: -0.1, momentum: -0.1 } },
      ],
    };
    expect(evaluateTempAdjust(params)).toBeNull();
  });
});

describe("evaluateSkillActivate", () => {
  it("fires when trusted skill available and entropy high", () => {
    const result = evaluateSkillActivate({
      ...baseParams,
      availableSkills: [{ name: "coding-skill", confidence: "trusted", taskCategories: ["coding"] }],
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("skill-activate");
    expect(result!.skillName).toBe("coding-skill");
  });

  it("returns null when no skills available", () => {
    expect(evaluateSkillActivate(baseParams)).toBeNull();
  });

  it("skips already-active skills", () => {
    const result = evaluateSkillActivate({
      ...baseParams,
      availableSkills: [{ name: "active-skill", confidence: "expert", taskCategories: [] }],
      activeSkillNames: ["active-skill"],
    });
    expect(result).toBeNull();
  });
});

describe("evaluatePromptSwitch", () => {
  it("fires after 4+ flat iterations", () => {
    const params = {
      ...baseParams,
      activePromptVariantId: "variant-A",
      entropyHistory: Array(5).fill({ composite: 0.6, trajectory: { shape: "flat" as const, derivative: 0, momentum: 0 } }),
    };
    const result = evaluatePromptSwitch(params);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("prompt-switch");
  });

  it("returns null without activePromptVariantId", () => {
    expect(evaluatePromptSwitch(baseParams)).toBeNull();
  });
});

describe("evaluateToolInject", () => {
  it("fires with high entropy and available tools", () => {
    const result = evaluateToolInject({
      ...baseParams,
      availableToolNames: ["web-search", "file-read"],
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("tool-inject");
    expect(result!.toolName).toBe("web-search");
  });

  it("returns null without available tools", () => {
    expect(evaluateToolInject(baseParams)).toBeNull();
  });
});

describe("evaluateMemoryBoost", () => {
  it("fires when retrieval mode is recent and entropy high", () => {
    const result = evaluateMemoryBoost({
      ...baseParams,
      activeRetrievalMode: "recent",
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("memory-boost");
    expect(result!.to).toBe("semantic");
  });

  it("returns null when already semantic", () => {
    expect(evaluateMemoryBoost({ ...baseParams, activeRetrievalMode: "semantic" })).toBeNull();
  });
});

describe("evaluateSkillReinject", () => {
  it("fires when skill content is missing from context", () => {
    const result = evaluateSkillReinject({
      ...baseParams,
      contextHasSkillContent: false,
      activeSkillNames: ["data-analysis"],
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("skill-reinject");
    expect(result!.skillName).toBe("data-analysis");
  });

  it("returns null when skill content is present", () => {
    expect(evaluateSkillReinject({ ...baseParams, contextHasSkillContent: true, activeSkillNames: ["x"] })).toBeNull();
  });

  it("returns null when no active skills", () => {
    expect(evaluateSkillReinject({ ...baseParams, contextHasSkillContent: false })).toBeNull();
  });
});

describe("evaluateHumanEscalate", () => {
  it("fires when 3+ decision types tried and entropy still high", () => {
    const result = evaluateHumanEscalate({
      ...baseParams,
      priorDecisionsThisRun: ["early-stop", "switch-strategy", "compress", "temp-adjust"],
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("human-escalate");
    expect(result!.decisionsExhausted.length).toBeGreaterThanOrEqual(3);
  });

  it("returns null with few prior decisions", () => {
    expect(evaluateHumanEscalate({ ...baseParams, priorDecisionsThisRun: ["early-stop"] })).toBeNull();
  });

  it("returns null when entropy is manageable", () => {
    const lowEntropy = {
      ...baseParams,
      entropyHistory: Array(5).fill({ composite: 0.3, trajectory: { shape: "converging" as const, derivative: -0.1, momentum: -0.1 } }),
      priorDecisionsThisRun: ["a", "b", "c", "d"],
    };
    expect(evaluateHumanEscalate(lowEntropy)).toBeNull();
  });
});
