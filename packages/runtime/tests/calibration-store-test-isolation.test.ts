// Run: bun test packages/runtime/tests/calibration-store-test-isolation.test.ts --timeout 15000
//
// Regression test for a real incident (2026-08-24): `CalibrationStore`
// defaults to a REAL disk path (`~/.reactive-agents/calibration.db`), unlike
// `BanditStore` (defaults `:memory:`) and `memoryOptions.dbPath` (which
// already had test-mode `:memory:` auto-resolution in
// `runtime-construction.ts`). Once `calibration-update-subscriber.ts` grew a
// real `updateCalibration()` caller, a single `bun test` run wrote synthetic
// calibration rows into the user's live, months-old calibration cache under
// throwaway modelIds ("test", "test-model", "sentinel-model", "unknown") —
// and since `updateCalibration` accumulates scores onto whatever row already
// exists for that modelId, a test using a real model id would have silently
// corrupted real historical calibration data.
import { describe, it, expect } from "bun:test";
import { resolveReactiveIntelligenceOptions } from "../src/builder/build-effect/runtime-construction.js";

describe("resolveReactiveIntelligenceOptions — calibration store test-mode isolation", () => {
  it("pins calibrationDbPath to :memory: under provider 'test'", () => {
    const result = resolveReactiveIntelligenceOptions(undefined, true, "test", undefined);
    expect(result?.calibrationDbPath).toBe(":memory:");
  });

  it("pins calibrationDbPath to :memory: under NODE_ENV=test regardless of provider", () => {
    const result = resolveReactiveIntelligenceOptions(undefined, true, "anthropic", "test");
    expect(result?.calibrationDbPath).toBe(":memory:");
  });

  it("does not touch calibrationDbPath outside test conditions", () => {
    const result = resolveReactiveIntelligenceOptions(undefined, true, "anthropic", "production");
    expect(result?.calibrationDbPath).toBeUndefined();
  });

  it("honors an explicit calibrationDbPath even under the test provider", () => {
    const result = resolveReactiveIntelligenceOptions(
      { calibrationDbPath: "/custom/path.db" },
      true,
      "test",
      undefined,
    );
    expect(result?.calibrationDbPath).toBe("/custom/path.db");
  });

  it("does nothing when reactive intelligence is disabled", () => {
    const result = resolveReactiveIntelligenceOptions(undefined, false, "test", undefined);
    expect(result?.calibrationDbPath).toBeUndefined();
  });

  it("preserves other reactiveIntelligenceOptions fields when pinning calibrationDbPath", () => {
    const result = resolveReactiveIntelligenceOptions(
      { learning: { skillSynthesis: false } },
      true,
      "test",
      undefined,
    );
    expect(result?.calibrationDbPath).toBe(":memory:");
    expect(result?.learning?.skillSynthesis).toBe(false);
  });
});
