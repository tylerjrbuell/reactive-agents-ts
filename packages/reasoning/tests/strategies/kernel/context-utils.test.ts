import { describe, it, expect } from "bun:test";
import { buildCompactedContext, formatStepForContext } from "../../../src/strategies/kernel/context-utils.js";

const makeStep = (type: string, content: string) => ({
  id: "01JTEST",
  type,
  content,
  timestamp: new Date(),
});

describe("buildCompactedContext", () => {
  it("returns initialContext + formatted steps when steps are few", () => {
    const steps = [
      makeStep("thought", "I'll search for this"),
      makeStep("observation", "Search returned 3 results"),
    ];
    const result = buildCompactedContext("Task: find info", steps as any, undefined);
    expect(result).toContain("Task: find info");
    expect(result).toContain("Search returned 3 results");
    expect(result).not.toContain("[Earlier steps");
  });

  it("compacts older steps when over compactAfterSteps threshold", () => {
    const steps = Array.from({ length: 8 }, (_, i) =>
      makeStep(i % 2 === 0 ? "thought" : "observation", `Content for step ${i + 1}`),
    );
    const result = buildCompactedContext("Task: test", steps as any, {
      compactAfterSteps: 6,
      fullDetailSteps: 4,
    } as any);
    expect(result).toContain("[Earlier steps");
    expect(result).toContain("[Recent steps]");
    // Recent 4 steps should be in full detail
    expect(result).toContain("Content for step 5");
    expect(result).toContain("Content for step 8");
  });

  it("handles empty steps gracefully", () => {
    const result = buildCompactedContext("Task: empty", [], undefined);
    expect(result).toBe("Task: empty");
  });

  it("uses default thresholds when no profile provided", () => {
    // Default: compactAfterSteps=6, fullDetailSteps=4
    const steps = Array.from({ length: 7 }, (_, i) =>
      makeStep("thought", `Step ${i + 1}`),
    );
    const result = buildCompactedContext("Task", steps as any, undefined);
    expect(result).toContain("[Earlier steps");
  });
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
