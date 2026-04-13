// Run: bun test packages/runtime/tests/auto-max-calls-per-tool.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { buildAutoMaxCallsPerTool } from "../src/execution-engine.js";

describe("buildAutoMaxCallsPerTool", () => {
  it("uses required minCalls + retry buffer when parallel mode is enabled", () => {
    const maxCalls = buildAutoMaxCallsPerTool({
      parallelToolCallsEnabled: true,
      requiredTools: ["web-search"],
      requiredToolQuantities: { "web-search": 4 },
    });

    // minCalls (4) + retry buffer (2) = 6
    expect(maxCalls["web-search"]).toBe(6);
  });

  it("uses minCalls=1 + retry buffer when quantity is missing", () => {
    const maxCalls = buildAutoMaxCallsPerTool({
      parallelToolCallsEnabled: true,
      requiredTools: ["file-read"],
    });

    // minCalls (1) + retry buffer (2) = 3
    expect(maxCalls["file-read"]).toBe(3);
  });

  it("disables auto budgets in sequential mode", () => {
    const maxCalls = buildAutoMaxCallsPerTool({
      parallelToolCallsEnabled: false,
      requiredTools: ["file-write"],
      requiredToolQuantities: { "file-write": 4 },
    });

    expect(Object.keys(maxCalls)).toHaveLength(0);
  });
});
