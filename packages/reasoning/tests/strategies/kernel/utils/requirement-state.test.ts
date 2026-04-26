// Run: bun test packages/reasoning/tests/kernel/capabilities/verify/requirement-state.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import {
  buildSuccessfulToolCallCounts,
  getMissingRequiredToolsFromSteps,
  buildAttemptedToolCallCounts,
  getPermanentlyFailedRequiredTools,
  getEffectiveMissingRequiredTools,
} from "../../../../src/kernel/capabilities/verify/requirement-state.js";

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

  it("counts all observation attempts regardless of success", () => {
    const steps = [
      makeStep("observation", "fail1", {
        observationResult: { success: false, toolName: "gws-cli" } as any,
      }),
      makeStep("observation", "fail2", {
        observationResult: { success: false, toolName: "gws-cli" } as any,
      }),
      makeStep("observation", "ok", {
        observationResult: { success: true, toolName: "web-search" } as any,
      }),
    ];

    const counts = buildAttemptedToolCallCounts(steps);
    expect(counts["gws-cli"]).toBe(2);
    expect(counts["web-search"]).toBe(1);
  });

  it("identifies required tools that were attempted but never succeeded", () => {
    const steps = [
      makeStep("observation", "fail", {
        observationResult: { success: false, toolName: "gws-cli" } as any,
      }),
      makeStep("observation", "ok", {
        observationResult: { success: true, toolName: "web-search" } as any,
      }),
    ];

    const failed = getPermanentlyFailedRequiredTools(steps, ["gws-cli", "web-search", "file-write"]);
    // gws-cli: attempted + failed, web-search: succeeded, file-write: never attempted
    expect(failed).toContain("gws-cli");
    expect(failed).not.toContain("web-search");
    expect(failed).not.toContain("file-write");
  });

  it("does not mark a tool as permanently failed if it eventually succeeded", () => {
    const steps = [
      makeStep("observation", "fail", {
        observationResult: { success: false, toolName: "web-search" } as any,
      }),
      makeStep("observation", "ok", {
        observationResult: { success: true, toolName: "web-search" } as any,
      }),
    ];

    const failed = getPermanentlyFailedRequiredTools(steps, ["web-search"]);
    expect(failed).toHaveLength(0);
  });

  it("getEffectiveMissingRequiredTools excludes permanently-failed tools from nudge list", () => {
    const steps = [
      makeStep("observation", "fail", {
        observationResult: { success: false, toolName: "gws-cli" } as any,
      }),
    ];

    // gws-cli is required but permanently failed — should be excluded from effective missing
    const effective = getEffectiveMissingRequiredTools(steps, ["gws-cli", "file-write"]);
    expect(effective).not.toContain("gws-cli");
    // file-write was never attempted — still genuinely missing
    expect(effective).toContain("file-write");
  });

  it("getEffectiveMissingRequiredTools returns empty when all required tools either succeeded or permanently failed", () => {
    const steps = [
      makeStep("observation", "ok", {
        observationResult: { success: true, toolName: "web-search" } as any,
      }),
      makeStep("observation", "fail", {
        observationResult: { success: false, toolName: "gws-cli" } as any,
      }),
    ];

    const effective = getEffectiveMissingRequiredTools(steps, ["web-search", "gws-cli"]);
    expect(effective).toHaveLength(0);
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
