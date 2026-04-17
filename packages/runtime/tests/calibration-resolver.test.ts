import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModelCalibration, resolveModelCalibrationAsync } from "../src/calibration-resolver.js";
import { appendObservation } from "@reactive-agents/reactive-intelligence";
import type { RunObservation } from "@reactive-agents/reactive-intelligence";

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
