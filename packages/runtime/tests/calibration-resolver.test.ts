import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveModelCalibration,
  resolveModelCalibrationAsync,
  resolveModelCalibrationWithProvenance,
} from "../src/calibration-resolver.js";
import { appendObservation } from "@reactive-agents/reactive-intelligence";
import { Effect } from "effect";
import { resolveCalibration as resolveEngineCalibration } from "../src/engine/phases/agent-loop/setup/calibration.js";import type { RunObservation } from "@reactive-agents/reactive-intelligence";

let testRoot: string;
beforeEach(() => { testRoot = mkdtempSync(join(tmpdir(), "ra-resolve-")); });
afterEach(() => { rmSync(testRoot, { recursive: true, force: true }); });

const run: RunObservation = {
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

describe("resolveModelCalibration", () => {
  it("returns undefined when no calibration file exists and no observations", () => {
    const cal = resolveModelCalibration("totally-unknown:model", { observationsBaseDir: testRoot });
    expect(cal).toBeUndefined();
  });

  it("returns the shipped prior for a known model", () => {
    const cal = resolveModelCalibration("gemma4:e4b", { observationsBaseDir: testRoot });
    expect(cal?.modelId).toBe("gemma4:e4b");
  });

  it("applies local observations when threshold is met", () => {
    for (let i = 0; i < 5; i++) {
      appendObservation("gemma4:e4b", run, { baseDir: testRoot });
    }
    const cal = resolveModelCalibration("gemma4:e4b", { observationsBaseDir: testRoot });
    expect(cal?.parallelCallCapability).toBe("reliable");
  });
});

describe("resolveModelCalibrationWithProvenance", () => {
  it("labels every field of a shipped prior 'shipped'", () => {
    const res = resolveModelCalibrationWithProvenance("gemma4:e4b", { observationsBaseDir: testRoot });
    expect(res?.calibration).toEqual(resolveModelCalibration("gemma4:e4b", { observationsBaseDir: testRoot })!);
    expect(res?.provenance.steeringCompliance).toBe("shipped");
    expect(res?.provenance.parallelCallCapability).toBe("shipped");
  });

  it("labels community-declared fields 'community'", () => {
    const res = resolveModelCalibrationWithProvenance("gemma4:e4b", {
      observationsBaseDir: testRoot,
      communityProfile: { classifierReliability: "low" },
    });
    expect(res?.calibration.classifierReliability).toBe("low");
    expect(res?.provenance.classifierReliability).toBe("community");
    expect(res?.provenance.steeringCompliance).toBe("shipped");
  });

  it("labels fields changed by local observations 'learned'", () => {
    const shipped = resolveModelCalibration("gemma4:e4b", { observationsBaseDir: testRoot });
    expect(shipped?.parallelCallCapability).not.toBe("sequential-only");
    // No run ever made a parallel call: the learned capability is sequential-only.
    for (let i = 0; i < 5; i++) appendObservation("gemma4:e4b", { ...run, parallelTurnCount: 0 }, { baseDir: testRoot });
    const res = resolveModelCalibrationWithProvenance("gemma4:e4b", { observationsBaseDir: testRoot });
    expect(res?.calibration.parallelCallCapability).toBe("sequential-only");
    expect(res?.provenance.parallelCallCapability).toBe("learned");
    expect(res?.provenance.steeringCompliance).toBe("shipped");
  });

  it("an uncalibrated model with local observations resolves learned values with provenance 'learned'", () => {
    for (let i = 0; i < 5; i++) appendObservation("totally-unknown:model", run, { baseDir: testRoot });
    const res = resolveModelCalibrationWithProvenance("totally-unknown:model", { observationsBaseDir: testRoot });
    expect(res).toBeDefined();
    expect(res?.calibration.modelId).toBe("totally-unknown:model");
    expect(res?.calibration.parallelCallCapability).toBe("reliable");
    expect(res?.provenance.parallelCallCapability).toBe("learned");
    // Everything not learned falls back to the framework defaults.
    expect(res?.provenance.steeringCompliance).toBe("default");
    // The plain resolver applies the same learning.
    expect(resolveModelCalibration("totally-unknown:model", { observationsBaseDir: testRoot })?.parallelCallCapability).toBe("reliable");
  });

  it("localObservations: false ignores recorded observations", () => {
    for (let i = 0; i < 5; i++) appendObservation("totally-unknown:model", run, { baseDir: testRoot });
    expect(
      resolveModelCalibration("totally-unknown:model", { observationsBaseDir: testRoot, localObservations: false }),
    ).toBeUndefined();
  });

  it("the engine's test provider ignores home-dir observations unless a dir is set", async () => {
    for (let i = 0; i < 5; i++) appendObservation("totally-unknown:model", run, { baseDir: testRoot });
    // Learned calibration is opt-in; this run opts in, so only the
    // test-provider observations-dir gate decides.
    const config: Parameters<typeof resolveEngineCalibration>[0] = {
      calibration: "auto",
      provider: "test",
      defaultModel: "totally-unknown:model",
      reactiveIntelligenceOptions: { communityCalibration: false, learnedCalibration: true },
    };
    const prev = process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"];
    try {
      delete process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"];
      expect(await Effect.runPromise(resolveEngineCalibration(config))).toBeUndefined();
      process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"] = testRoot;
      expect((await Effect.runPromise(resolveEngineCalibration(config)))?.parallelCallCapability).toBe("reliable");
    } finally {
      if (prev === undefined) delete process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"];
      else process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"] = prev;
    }
  });

  it("an uncalibrated model below the observation threshold stays unresolved", () => {
    for (let i = 0; i < 4; i++) appendObservation("totally-unknown:model", run, { baseDir: testRoot });
    expect(resolveModelCalibrationWithProvenance("totally-unknown:model", { observationsBaseDir: testRoot })).toBeUndefined();
    expect(resolveModelCalibration("totally-unknown:model", { observationsBaseDir: testRoot })).toBeUndefined();
  });
});

describe("resolveModelCalibrationAsync", () => {
  it("returns the sync result when fetchCommunity is false", async () => {
    const cal = await resolveModelCalibrationAsync("gemma4:e4b", {
      observationsBaseDir: testRoot,
      fetchCommunity: false,
    });
    expect(cal?.modelId).toBe("gemma4:e4b");
  });

  it("merges community profile when fetchCommunity is true and profile found", async () => {
    const cal = await resolveModelCalibrationAsync("gemma4:e4b", {
      observationsBaseDir: testRoot,
      communityCacheDir: testRoot,
      fetchCommunity: true,
      communityEndpoint: "http://mock.invalid",
      communityFetchImpl: async () => new Response(
        JSON.stringify({ parallelCallCapability: "reliable", classifierReliability: "low" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    expect(cal?.parallelCallCapability).toBe("reliable");
    expect(cal?.classifierReliability).toBe("low");
  });

  it("falls back to sync result when community fetch fails", async () => {
    const cal = await resolveModelCalibrationAsync("gemma4:e4b", {
      observationsBaseDir: testRoot,
      fetchCommunity: true,
      communityEndpoint: "http://mock.invalid",
      communityFetchImpl: async () => { throw new Error("network down"); },
    });
    // Should still return the shipped prior, not undefined
    expect(cal?.modelId).toBe("gemma4:e4b");
  });

  it("returns undefined for completely unknown model with no community", async () => {
    const cal = await resolveModelCalibrationAsync("totally-unknown:xyz", {
      observationsBaseDir: testRoot,
      fetchCommunity: true,
      communityEndpoint: "http://mock.invalid",
      communityFetchImpl: async () => new Response("not found", { status: 404 }),
    });
    expect(cal).toBeUndefined();
  });
});
