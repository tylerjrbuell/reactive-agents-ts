import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModelCalibration } from "../src/calibration.js";
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
