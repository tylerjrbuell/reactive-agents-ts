import { describe, expect, test } from "bun:test"
import { calibrationArmVariant } from "./run-h3.js"
import { partnerOf } from "./calibration-lift-read.js"

describe("calibrationArmVariant (adaptive-lift arm seam)", () => {
  test("unset env leaves the default variant", () => {
    expect(calibrationArmVariant("cogito:8b", {})).toBeNull()
  })
  test("skip / auto map straight to the builder mode and keep the default variant id", () => {
    expect(calibrationArmVariant("qwen3:4b", { RA_BENCH_CALIBRATION: "skip" })?.config).toMatchObject({ calibration: "skip" })
    const v = calibrationArmVariant("qwen3:4b", { RA_BENCH_CALIBRATION: "auto" })
    expect(v?.id).toBe("ra-default")
  })
  test("swap picks the partner tier's shipped calibration", () => {
    expect(calibrationArmVariant("cogito:8b", { RA_BENCH_CALIBRATION: "swap" })?.config).toMatchObject({ calibration: { swapFrom: "qwen3:4b" } })
    expect(calibrationArmVariant("qwen3:4b", { RA_BENCH_CALIBRATION: "swap" })?.config).toMatchObject({ calibration: { swapFrom: "cogito:8b" } })
    expect(partnerOf("cogito:8b")).toBe("qwen3:4b")
  })
  test("bad value or swap on an unpaired tier throws", () => {
    expect(() => calibrationArmVariant("cogito:8b", { RA_BENCH_CALIBRATION: "nope" })).toThrow()
    expect(() => calibrationArmVariant("bonsai-2:27b", { RA_BENCH_CALIBRATION: "swap" })).toThrow()
  })
})
