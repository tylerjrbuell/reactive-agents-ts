import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendObservation } from "../../src/calibration/observations-store.js";
import { resolveCalibration } from "../../src/calibration/calibration-resolver.js";
import type { RunObservation } from "../../src/calibration/observations-types.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";

let testRoot: string;

beforeEach(() => { testRoot = mkdtempSync(join(tmpdir(), "ra-resolver-")); });
afterEach(() => { rmSync(testRoot, { recursive: true, force: true }); });

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

const parallelRun: RunObservation = {
  at: "2026-04-15T00:00:00.000Z",
  parallelTurnCount: 1,
  totalTurnCount: 3,
  dialect: "native-fc",
  classifierRequired: [],
  classifierActuallyCalled: [],
  subagentInvoked: 0,
  subagentSucceeded: 0,
  argValidityRate: 1.0,
};

describe("resolveCalibration", () => {
  it("returns the prior when no observations exist", () => {
    const result = resolveCalibration(prior, { observationsBaseDir: testRoot });
    expect(result).toBe(prior);
  });

  it("applies local observations once threshold is met", () => {
    for (let i = 0; i < 5; i++) {
      appendObservation("cogito", parallelRun, { baseDir: testRoot });
    }
    const result = resolveCalibration(prior, { observationsBaseDir: testRoot });
    expect(result.parallelCallCapability).toBe("reliable");
  });

  it("honours a community prior when passed explicitly", () => {
    const community: Partial<ModelCalibration> = {
      parallelCallCapability: "reliable",
      systemPromptAttention: "strong",
    };
    const result = resolveCalibration(prior, {
      observationsBaseDir: testRoot,
      communityProfile: community,
    });
    // Community overrides prior for the fields it declares
    expect(result.parallelCallCapability).toBe("reliable");
    expect(result.systemPromptAttention).toBe("strong");
    // Prior fields not in community stay
    expect(result.steeringCompliance).toBe(prior.steeringCompliance);
  });

  it("local posterior beats community prior once local samples meet threshold", () => {
    const community: Partial<ModelCalibration> = { parallelCallCapability: "reliable" };
    for (let i = 0; i < 5; i++) {
      appendObservation("cogito", { ...parallelRun, parallelTurnCount: 0 }, { baseDir: testRoot });
    }
    const result = resolveCalibration(prior, {
      observationsBaseDir: testRoot,
      communityProfile: community,
    });
    // Local observed 0% parallel → sequential-only, overriding community's "reliable"
    expect(result.parallelCallCapability).toBe("sequential-only");
  });
});
