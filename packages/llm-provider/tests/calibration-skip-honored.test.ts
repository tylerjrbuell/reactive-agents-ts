import { describe, it, expect } from "bun:test";
import { selectAdapter, localModelAdapter } from "../src/adapter.js";
import { loadCalibration, type ModelCalibration } from "../src/calibration.js";
import { resolveCapability, describeCapabilityResolution } from "../src/capability-resolver.js";

const caps = { supportsToolCalling: true };
// Shipped calibration with optimalToolResultChars: 2000.
const SHIPPED_MODEL = "cogito:14b";

describe("selectAdapter honors the resolved calibration input (F1)", () => {
  it("fixture: the shipped calibration exists and carries the override", () => {
    expect(loadCalibration(SHIPPED_MODEL)?.optimalToolResultChars).toBe(2000);
  });

  it("auto (default) still loads shipped optimalToolResultChars", () => {
    expect(selectAdapter(caps, "local", SHIPPED_MODEL).profileOverrides?.toolResultMaxChars).toBe(2000);
    expect(
      selectAdapter(caps, "local", SHIPPED_MODEL, "auto").profileOverrides?.toolResultMaxChars,
    ).toBe(2000);
  });

  it("skip applies no shipped override and keeps the pure tier adapter", () => {
    const r = selectAdapter(caps, "local", SHIPPED_MODEL, "skip");
    expect(r.profileOverrides).toBeUndefined();
    expect(r.adapter).toBe(localModelAdapter);
  });

  it("an explicit calibration object wins over the shipped JSON", () => {
    const shipped = loadCalibration(SHIPPED_MODEL) as ModelCalibration;
    const custom: ModelCalibration = { ...shipped, optimalToolResultChars: 777 };
    expect(selectAdapter(caps, "local", SHIPPED_MODEL, custom).profileOverrides?.toolResultMaxChars).toBe(777);
  });
});

describe("describeCapabilityResolution (G3)", () => {
  it("exposes source, tier, recommendedNumCtx, supportsThinkingMode", () => {
    const cap = resolveCapability("ollama", "never-heard-of-it:1b");
    const d = describeCapabilityResolution(cap);
    expect(d).toEqual({
      provider: "ollama",
      model: "never-heard-of-it:1b",
      source: "fallback",
      tier: cap.tier,
      recommendedNumCtx: cap.recommendedNumCtx,
      supportsThinkingMode: cap.supportsThinkingMode,
    });
  });
});
