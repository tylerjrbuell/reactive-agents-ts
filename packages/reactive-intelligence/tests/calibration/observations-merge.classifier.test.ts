import { describe, it, expect } from "bun:test";
import { mergeObservationsIntoPrior } from "../../src/calibration/observations-merge.js";
import type { ModelObservations, RunObservation } from "../../src/calibration/observations-types.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";

const prior: ModelCalibration = {
  modelId: "cogito",
  calibratedAt: "2026-04-14T00:00:00.000Z",
  probeVersion: 1,
  runsAveraged: 3,
  steeringCompliance: "hybrid",
  parallelCallCapability: "partial",
  observationHandling: "needs-inline-facts",
  systemPromptAttention: "moderate",
  optimalToolResultChars: 1500,
  toolCallDialect: "none",
};

function mkRun(hasFalsePositive: boolean): RunObservation {
  return {
    at: new Date().toISOString(),
    parallelTurnCount: 0,
    totalTurnCount: 3,
    dialect: "native-fc",
    classifierRequired: hasFalsePositive ? ["web-search", "code-execute"] : ["web-search"],
    classifierActuallyCalled: ["web-search"], // code-execute never called when hasFalsePositive=true
    subagentInvoked: 0,
    subagentSucceeded: 0,
    argValidityRate: 1.0,
  };
}

function mkObs(falsePositiveCount: number, totalCount: number): ModelObservations {
  const runs: RunObservation[] = [];
  for (let i = 0; i < totalCount; i++) {
    runs.push(mkRun(i < falsePositiveCount));
  }
  return { schemaVersion: 1, modelId: "cogito", sampleCount: totalCount, runs };
}

describe("classifierReliability derivation", () => {
  it("marks 'high' when <20% of runs have false positives", () => {
    // 0/5 = 0% FP
    const merged = mergeObservationsIntoPrior(prior, mkObs(0, 5));
    expect(merged.classifierReliability).toBe("high");
  });

  it("marks 'low' when ≥40% of runs have false positives", () => {
    // 3/5 = 60% FP
    const merged = mergeObservationsIntoPrior(prior, mkObs(3, 5));
    expect(merged.classifierReliability).toBe("low");
  });

  it("marks 'high' for the 20-40% band (conservative — not enough signal)", () => {
    // 1/5 = 20% FP — borderline, defaults to "high" (don't skip classifier on weak signal)
    const merged = mergeObservationsIntoPrior(prior, mkObs(1, 5));
    expect(merged.classifierReliability).toBe("high");
  });

  it("does not set classifierReliability when below sample threshold", () => {
    const merged = mergeObservationsIntoPrior(prior, mkObs(3, 3));
    // Below OVERRIDE_THRESHOLD (5) — prior has no classifierReliability, so merged shouldn't either
    expect(merged.classifierReliability).toBeUndefined();
  });

  it("detects false positives by comparing classifierRequired vs classifierActuallyCalled", () => {
    // Run where classifier required ["web-search", "code-execute"] but only web-search was called
    // → code-execute is a false positive
    const merged = mergeObservationsIntoPrior(prior, mkObs(5, 5));
    expect(merged.classifierReliability).toBe("low");
  });

  it("run with empty classifierRequired has no false positives", () => {
    const noClassifierRuns: RunObservation[] = Array.from({ length: 5 }, () => ({
      at: new Date().toISOString(),
      parallelTurnCount: 0,
      totalTurnCount: 3,
      dialect: "native-fc" as const,
      classifierRequired: [],
      classifierActuallyCalled: ["web-search"],
      subagentInvoked: 0,
      subagentSucceeded: 0,
      argValidityRate: 1.0,
    }));
    const obs: ModelObservations = { schemaVersion: 1, modelId: "cogito", sampleCount: 5, runs: noClassifierRuns };
    const merged = mergeObservationsIntoPrior(prior, obs);
    expect(merged.classifierReliability).toBe("high");
  });
});
