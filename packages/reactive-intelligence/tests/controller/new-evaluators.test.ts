import { describe, it, expect } from "bun:test";
import { evaluateTempAdjust } from "../../src/controller/evaluators/temp-adjust.js";
import { evaluateSkillActivate } from "../../src/controller/evaluators/skill-activate.js";
import { evaluateToolInject } from "../../src/controller/evaluators/tool-inject.js";
import type { ControllerEvalParams } from "../../src/types.js";

// WS-4 Phase 2 (2026-05-28) — describe blocks for `evaluatePromptSwitch`,
// `evaluateMemoryBoost`, `evaluateSkillReinject`, `evaluateHumanEscalate`
// removed alongside the prune of those 4 ⚠ UNWIRED variants from the
// ControllerDecision union (master plan §3.6 RC-3, anti-mission #6).

const baseParams: ControllerEvalParams = {
  entropyHistory: [
    { composite: 0.5, trajectory: { shape: "flat", derivative: 0.01, momentum: 0 } },
    { composite: 0.6, trajectory: { shape: "diverging", derivative: 0.06, momentum: 0.05 } },
    { composite: 0.7, trajectory: { shape: "diverging", derivative: 0.08, momentum: 0.1 } },
    { composite: 0.8, trajectory: { shape: "diverging", derivative: 0.1, momentum: 0.2 } },
  ],
  iteration: 4,
  maxIterations: 10,
  strategy: "reactive",
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
