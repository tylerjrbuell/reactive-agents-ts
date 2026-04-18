// Run: bun test packages/reasoning/tests/strategies/kernel/utils/lane-controller.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import type { ReasoningStep } from "../../../../src/types/index.js";
import {
  decideExecutionLane,
  shouldInjectOracleNudge,
} from "../../../../src/strategies/kernel/utils/lane-controller.js";

function makeSuccessObs(toolName: string): ReasoningStep {
  return {
    type: "observation",
    content: `result of ${toolName}`,
    metadata: { observationResult: { success: true, toolName } },
  };
}

function makeFailureObs(toolName: string): ReasoningStep {
  return {
    type: "observation",
    content: `error from ${toolName}`,
    metadata: { observationResult: { success: false, toolName } },
  };
}

describe("lane controller", () => {
  it("returns gather lane when required quota is still missing", () => {
    const steps: ReasoningStep[] = [makeSuccessObs("web-search")];
    const result = decideExecutionLane({
      requiredTools: ["web-search"],
      requiredToolQuantities: { "web-search": 2 },
      steps,
    });

    expect(result.lane).toBe("gather");
    expect(result.canFinalize).toBe(false);
    expect(result.missingRequiredTools).toEqual(["web-search"]);
  });

  it("returns synthesize lane when required quota is satisfied", () => {
    const steps: ReasoningStep[] = [
      makeSuccessObs("web-search"),
      makeSuccessObs("web-search"),
    ];
    const result = decideExecutionLane({
      requiredTools: ["web-search"],
      requiredToolQuantities: { "web-search": 2 },
      steps,
    });

    expect(result.lane).toBe("synthesize");
    expect(result.canFinalize).toBe(true);
    expect(result.missingRequiredTools).toEqual([]);
  });

  it("returns synthesize lane when permanently-failed required tool is excluded", () => {
    // Tool was attempted but always failed — should NOT be in missingRequiredTools
    const steps: ReasoningStep[] = [makeFailureObs("gws-cli")];
    const result = decideExecutionLane({
      requiredTools: ["gws-cli"],
      steps,
    });

    expect(result.lane).toBe("synthesize");
    expect(result.canFinalize).toBe(true);
    expect(result.missingRequiredTools).toEqual([]);
  });

  it("keeps genuinely-missing required tool in gather lane", () => {
    // Tool was never attempted at all — still required
    const result = decideExecutionLane({
      requiredTools: ["web-search"],
      steps: [],
    });

    expect(result.lane).toBe("gather");
    expect(result.canFinalize).toBe(false);
    expect(result.missingRequiredTools).toEqual(["web-search"]);
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
