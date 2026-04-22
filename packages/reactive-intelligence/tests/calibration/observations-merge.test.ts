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

function runs(...parallelFlags: boolean[]): ModelObservations {
  const samples: RunObservation[] = parallelFlags.map((parallel, i) => ({
    at: `2026-04-15T12:${String(i).padStart(2, "0")}:00.000Z`,
    parallelTurnCount: parallel ? 1 : 0,
    totalTurnCount: 3,
    dialect: "native-fc",
    classifierRequired: [],
    classifierActuallyCalled: [],
    subagentInvoked: 0,
    subagentSucceeded: 0,
    argValidityRate: 1.0,
  }));
  return {
    schemaVersion: 1,
    modelId: "cogito",
    sampleCount: samples.length,
    runs: samples,
  };
}

describe("mergeObservationsIntoPrior", () => {
  it("returns prior unchanged when sample count below threshold (N=5)", () => {
    const merged = mergeObservationsIntoPrior(prior, runs(true, true, true));
    expect(merged.parallelCallCapability).toBe("partial");
    expect(merged).toBe(prior); // identity when no override
  });

  it("upgrades parallelCallCapability to 'reliable' when ≥80% of runs had parallel turns", () => {
    const merged = mergeObservationsIntoPrior(prior, runs(true, true, true, true, true));
    expect(merged.parallelCallCapability).toBe("reliable");
  });

  it("downgrades to 'sequential-only' when <20% of runs had parallel turns", () => {
    const merged = mergeObservationsIntoPrior(prior, runs(false, false, false, false, false));
    expect(merged.parallelCallCapability).toBe("sequential-only");
  });

  it("preserves 'partial' when rate falls in 20-80% band", () => {
    const merged = mergeObservationsIntoPrior(prior, runs(true, true, false, false, false));
    expect(merged.parallelCallCapability).toBe("partial");
  });

  it("leaves unrelated fields untouched", () => {
    const merged = mergeObservationsIntoPrior(prior, runs(true, true, true, true, true));
    expect(merged.steeringCompliance).toBe(prior.steeringCompliance);
    expect(merged.optimalToolResultChars).toBe(prior.optimalToolResultChars);
  });
});
