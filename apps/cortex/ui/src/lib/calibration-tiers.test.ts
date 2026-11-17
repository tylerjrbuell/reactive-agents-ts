import { describe, expect, it } from "bun:test";
import { calibrationTierHint, calibrationTiersOn, rawConfigForCalibrationTier } from "./calibration-tiers.js";

describe("calibration tiers", () => {
  it("both tiers read off when nothing is set", () => {
    expect(calibrationTiersOn(undefined)).toEqual({ learned: false, community: false });
    expect(calibrationTiersOn({})).toEqual({ learned: false, community: false });
  });

  it("turning a tier on writes the schema-valid shape (mode is required)", () => {
    expect(rawConfigForCalibrationTier({}, "learned", true)).toEqual({ calibration: { mode: "auto", learned: true } });
    const both = rawConfigForCalibrationTier({ calibration: { mode: "auto", learned: true } }, "community", true);
    expect(both).toEqual({ calibration: { mode: "auto", learned: true, community: true } });
    expect(calibrationTiersOn(both)).toEqual({ learned: true, community: true });
  });

  it("turning the last tier off removes calibration; other keys survive", () => {
    const on = rawConfigForCalibrationTier({ debrief: true }, "learned", true);
    expect(rawConfigForCalibrationTier(on, "learned", false)).toEqual({ debrief: true });
    expect(rawConfigForCalibrationTier(on, "community", false)).toEqual(on);
  });

  it("keeps an explicit mode (skip) set elsewhere", () => {
    const skip = { calibration: { mode: "skip" } };
    expect(rawConfigForCalibrationTier(skip, "learned", true)).toEqual({ calibration: { mode: "skip", learned: true } });
    expect(rawConfigForCalibrationTier(skip, "learned", false)).toEqual({ calibration: { mode: "skip" } });
    expect(calibrationTierHint(skip)).toContain("skipped");
  });
});
