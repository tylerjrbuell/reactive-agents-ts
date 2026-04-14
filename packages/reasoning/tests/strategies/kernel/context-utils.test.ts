// Run: bun test packages/reasoning/tests/strategies/kernel/context-utils.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import {
  formatStepForContext,
  extractObservationFinding,
  summarizeTriplet,
} from "../../../src/strategies/kernel/utils/context-utils.js";

const makeStep = (type: string, content: string, metadata?: Record<string, unknown>) => ({
  id: "01JTEST",
  type,
  content,
  timestamp: new Date(),
  metadata,
});

describe("formatStepForContext", () => {
  it("prefixes observations with 'Observation:'", () => {
    const step = makeStep("observation", "Tool returned 5 results");
    expect(formatStepForContext(step as any)).toContain("Observation:");
  });

  it("prefixes actions with 'Action:'", () => {
    const step = makeStep("action", "ACTION: file-write(...)");
    expect(formatStepForContext(step as any)).toContain("Action:");
  });

  it("returns thought content as-is", () => {
    const step = makeStep("thought", "I should search first.");
    expect(formatStepForContext(step as any)).toBe("I should search first.");
  });
});

describe("extractObservationFinding", () => {
  it("preserves error markers", () => {
    const content = "Error: tool call failed with status 500";
    expect(extractObservationFinding(content)).toContain("Error");
  });

  it("returns a non-empty string for normal content", () => {
    const result = extractObservationFinding("BTC price is $45,000 USD");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("summarizeTriplet", () => {
  it("shows failure icon for failed observations", () => {
    const thought = makeStep("thought", "I will search");
    const action = makeStep("action", '{"tool":"web-search","args":{}}');
    const obs = makeStep("observation", "Error: timeout", { observationResult: { success: false } });
    const result = summarizeTriplet(thought as any, action as any, obs as any);
    expect(result).toContain("✗");
  });
});
