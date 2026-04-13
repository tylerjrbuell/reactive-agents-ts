// Run: bun test packages/reasoning/tests/strategies/kernel/utils/lane-controller.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import {
  decideExecutionLane,
  shouldInjectOracleNudge,
} from "../../../../src/strategies/kernel/utils/lane-controller.js";

describe("lane controller", () => {
  it("returns gather lane when required quota is still missing", () => {
    const result = decideExecutionLane({
      requiredTools: ["web-search"],
      requiredToolQuantities: { "web-search": 2 },
      successfulToolCounts: { "web-search": 1 },
    });

    expect(result.lane).toBe("gather");
    expect(result.canFinalize).toBe(false);
    expect(result.missingRequiredTools).toEqual(["web-search"]);
  });

  it("returns synthesize lane when required quota is satisfied", () => {
    const result = decideExecutionLane({
      requiredTools: ["web-search"],
      requiredToolQuantities: { "web-search": 2 },
      successfulToolCounts: { "web-search": 2 },
    });

    expect(result.lane).toBe("synthesize");
    expect(result.canFinalize).toBe(true);
    expect(result.missingRequiredTools).toEqual([]);
  });

  it("blocks oracle nudge in gather lane", () => {
    expect(
      shouldInjectOracleNudge({
        lane: "gather",
        oracleReady: true,
      }),
    ).toBe(false);
  });

  it("allows oracle nudge in synthesize lane", () => {
    expect(
      shouldInjectOracleNudge({
        lane: "synthesize",
        oracleReady: true,
      }),
    ).toBe(true);
  });
});
