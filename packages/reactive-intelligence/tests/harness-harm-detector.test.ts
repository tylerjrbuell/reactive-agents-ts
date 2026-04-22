import { describe, it, expect } from "bun:test";
import { isHarnessHarmSuspected, isHarnessHarmConfirmed } from "../src/controller/handlers/harness-harm-detector.js";

describe("isHarnessHarmSuspected", () => {
  it("returns true when high intervention count + low tool success + task failed", () => {
    expect(isHarnessHarmSuspected({
      interventionCount: 4,
      toolSuccessRate: 0.3,
      taskSucceeded: false,
    })).toBe(true);
  });

  it("returns false when task succeeded despite interventions", () => {
    expect(isHarnessHarmSuspected({
      interventionCount: 4,
      toolSuccessRate: 0.3,
      taskSucceeded: true,
    })).toBe(false);
  });

  it("returns false when tool success rate is adequate", () => {
    expect(isHarnessHarmSuspected({
      interventionCount: 5,
      toolSuccessRate: 0.7,
      taskSucceeded: false,
    })).toBe(false);
  });

  it("returns false when intervention count is low", () => {
    expect(isHarnessHarmSuspected({
      interventionCount: 2,
      toolSuccessRate: 0.1,
      taskSucceeded: false,
    })).toBe(false);
  });
});

describe("isHarnessHarmConfirmed", () => {
  it("confirms after 3 suspected runs", () => {
    expect(isHarnessHarmConfirmed(3)).toBe(true);
  });

  it("not confirmed at 2 suspected runs", () => {
    expect(isHarnessHarmConfirmed(2)).toBe(false);
  });
});
