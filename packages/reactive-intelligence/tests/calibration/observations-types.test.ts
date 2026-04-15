import { describe, it, expect } from "bun:test";
import { emptyObservations, type ModelObservations } from "../../src/calibration/observations-types.js";

describe("ModelObservations", () => {
  it("emptyObservations returns a fresh zeroed record for the given modelId", () => {
    const obs = emptyObservations("cogito");
    expect(obs.modelId).toBe("cogito");
    expect(obs.sampleCount).toBe(0);
    expect(obs.schemaVersion).toBeGreaterThan(0);
    expect(obs.runs).toEqual([]);
  });

  it("runs are tagged with ISO timestamps and bounded counts", () => {
    const now = new Date().toISOString();
    const run: ModelObservations["runs"][number] = {
      at: now,
      parallelTurnCount: 2,
      totalTurnCount: 5,
      dialect: "native-fc",
      classifierRequired: ["web-search"],
      classifierActuallyCalled: ["web-search"],
      subagentInvoked: 0,
      subagentSucceeded: 0,
      argValidityRate: 1.0,
    };
    expect(run.at).toBe(now);
  });
});
