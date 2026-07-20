/**
 * P0-9 regression pin: `.withCalibration("skip")` is a REAL opt-out.
 *
 * Before the fix, runtime-construction rewrote an explicit `"skip"` to `"auto"`
 * whenever reasoning was enabled, so the opt-out was structurally un-passable.
 * `resolveCalibrationSetting` is the boundary that now distinguishes "unset"
 * (auto-enable when reasoning is on) from an explicit `"skip"` (always skip).
 */
import { describe, test, expect } from "bun:test";
import { resolveCalibrationSetting } from "../src/builder/build-effect/runtime-construction";
import type { CalibrationMode } from "../src/types";

describe("resolveCalibrationSetting — P0-9 skip opt-out", () => {
  test('explicit "skip" is honored even when reasoning is ON', () => {
    // This is the exact case the bug ignored: reasoning on + user opted out.
    expect(resolveCalibrationSetting("skip", true)).toBeUndefined();
  });

  test('explicit "skip" is honored when reasoning is OFF', () => {
    expect(resolveCalibrationSetting("skip", false)).toBeUndefined();
  });

  test('unset + reasoning ON auto-enables calibration', () => {
    expect(resolveCalibrationSetting(undefined, true)).toBe("auto");
  });

  test('unset + reasoning OFF applies no calibration', () => {
    expect(resolveCalibrationSetting(undefined, false)).toBeUndefined();
  });

  test('explicit "auto" always wins', () => {
    expect(resolveCalibrationSetting("auto", false)).toBe("auto");
    expect(resolveCalibrationSetting("auto", true)).toBe("auto");
  });

  test("explicit ModelCalibration object passes through unchanged", () => {
    const cal = { modelId: "test-model" } as unknown as CalibrationMode;
    expect(resolveCalibrationSetting(cal, true)).toBe(cal);
    expect(resolveCalibrationSetting(cal, false)).toBe(cal);
  });
});
