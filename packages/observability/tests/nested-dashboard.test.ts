import { describe, test, expect } from "bun:test";
import { formatMetricsDashboard, type DashboardData } from "../src/exporters/console-exporter";

const baseDashboard: DashboardData = {
  status: "success", totalDuration: 1000, stepCount: 1, tokenCount: 100,
  estimatedCost: 0, modelName: "m", provider: "test",
  phases: [], tools: [], alerts: [],
};

describe("formatMetricsDashboard nested rendering", () => {
  test("renders exactly one top-level box even with children", () => {
    const parent: DashboardData = {
      ...baseDashboard,
      children: [{ name: "bitcoin-price-finder", data: { ...baseDashboard, tokenCount: 50 } }],
    };
    const output = formatMetricsDashboard(parent);
    const boxCount = (output.match(/Agent Execution Summary/g) ?? []).length;
    expect(boxCount).toBe(1);
    expect(output).toContain("bitcoin-price-finder");
  });

  test("output for a childless dashboard is unchanged from before", () => {
    const output = formatMetricsDashboard(baseDashboard);
    expect(output).toContain("Agent Execution Summary");
    expect(output).not.toContain("Sub-agent");
  });

  test("renders multiple children, each under its own Sub-agent heading", () => {
    const parent: DashboardData = {
      ...baseDashboard,
      children: [
        { name: "researcher", data: { ...baseDashboard, tokenCount: 20 } },
        { name: "writer", data: { ...baseDashboard, tokenCount: 30 } },
      ],
    };
    const output = formatMetricsDashboard(parent);
    const boxCount = (output.match(/Agent Execution Summary/g) ?? []).length;
    expect(boxCount).toBe(1);
    expect(output).toContain("Sub-agent: researcher");
    expect(output).toContain("Sub-agent: writer");
  });
});
