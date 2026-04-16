import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModelCalibrationAsync } from "../src/calibration.js";

let testRoot: string;
beforeEach(() => { testRoot = mkdtempSync(join(tmpdir(), "ra-async-")); });
afterEach(() => { rmSync(testRoot, { recursive: true, force: true }); });

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
