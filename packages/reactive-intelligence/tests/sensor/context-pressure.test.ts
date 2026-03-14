import { describe, test, expect } from "bun:test";
import { computeContextPressure } from "../../src/sensor/context-pressure.js";

describe("context pressure (1E)", () => {
  test("low utilization returns low pressure", () => {
    const result = computeContextPressure({
      systemPrompt: "You are a helpful assistant.",
      toolResults: ["Result: Paris"],
      history: ["User: What is the capital?"],
      taskDescription: "Find capitals",
      contextLimit: 32_768,
    });
    expect(result.utilizationPct).toBeLessThan(0.1);
    expect(result.atRiskSections).toHaveLength(0);
  });

  test("high utilization detects at-risk sections", () => {
    const longHistory = Array(500).fill("User: This is a very long conversation turn that takes up context space.").join("\n");
    const result = computeContextPressure({
      systemPrompt: "System prompt",
      toolResults: [],
      history: [longHistory],
      taskDescription: "Test",
      contextLimit: 1000, // very small window
    });
    expect(result.utilizationPct).toBeGreaterThan(0.8);
    expect(result.atRiskSections.length).toBeGreaterThan(0);
  });

  test("task section always has signalDensity 1.0", () => {
    const result = computeContextPressure({
      systemPrompt: "",
      toolResults: [],
      history: [],
      taskDescription: "Important task",
      contextLimit: 32_768,
    });
    const taskSection = result.sections.find((s) => s.label === "task");
    expect(taskSection?.signalDensity).toBe(1.0);
  });

  test("older tool results have lower signal density", () => {
    const result = computeContextPressure({
      systemPrompt: "",
      toolResults: ["recent result", "old result 1", "old result 2", "old result 3"],
      history: [],
      taskDescription: "Test",
      contextLimit: 32_768,
    });
    const toolSection = result.sections.find((s) => s.label === "tool-results");
    expect(toolSection).toBeDefined();
    expect(toolSection!.signalDensity).toBeLessThan(1.0); // decayed
  });
});
