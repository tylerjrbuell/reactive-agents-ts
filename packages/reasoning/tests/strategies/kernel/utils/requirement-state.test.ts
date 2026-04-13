// Run: bun test packages/reasoning/tests/strategies/kernel/utils/requirement-state.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeStep } from "../../../../src/strategies/kernel/utils/step-utils.js";
import {
  buildSuccessfulToolCallCounts,
  getMissingRequiredToolsFromSteps,
} from "../../../../src/strategies/kernel/utils/requirement-state.js";

describe("requirement-state", () => {
  it("counts successful observations by tool name", () => {
    const steps = [
      makeStep("observation", "ok", {
        observationResult: {
          success: true,
          toolName: "web-search",
        } as any,
      }),
      makeStep("observation", "failed", {
        observationResult: {
          success: false,
          toolName: "web-search",
        } as any,
      }),
    ];

    expect(buildSuccessfulToolCallCounts(steps)["web-search"]).toBe(1);
  });

  it("does not double-count when delegated tool overlaps parent toolName", () => {
    const steps = [
      makeStep("observation", "delegated", {
        observationResult: {
          success: true,
          toolName: "spawn-agent",
          delegatedToolsUsed: ["web-search", "web-search"],
        } as any,
      }),
      makeStep("observation", "overlap", {
        observationResult: {
          success: true,
          toolName: "web-search",
          delegatedToolsUsed: ["web-search"],
        } as any,
      }),
    ];

    const counts = buildSuccessfulToolCallCounts(steps);
    expect(counts["web-search"]).toBe(2);
  });

  it("computes missing required tools from successful counts", () => {
    const steps = [
      makeStep("observation", "ok", {
        observationResult: {
          success: true,
          toolName: "web-search",
        } as any,
      }),
    ];

    const missing = getMissingRequiredToolsFromSteps(
      steps,
      ["web-search", "file-write"],
      { "web-search": 2, "file-write": 1 },
    );

    expect(missing).toEqual(["web-search", "file-write"]);
  });
});
