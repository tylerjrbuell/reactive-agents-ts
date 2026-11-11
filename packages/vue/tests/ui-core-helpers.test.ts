/** The binding re-exports ui-core's shared formatters and status vocabulary (G1, G2). */
import { describe, expect, it } from "bun:test";
import { formatCost, formatTokens, formatTurnDuration, modelWaitLabel, statusOfRun, statusOfTurn } from "../src/index.js";

describe("@reactive-agents/vue: ui-core display helpers", () => {
  it("re-exports the formatters and the status vocabulary", () => {
    expect(formatCost(0.00004)).toBe("<$0.0001");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTurnDuration(125_000)).toBe("2m 05s");
    expect(statusOfRun("stopped").tone).toBe("stopped");
    expect(statusOfTurn("interrupted").label).toBe("Interrupted");
    expect(modelWaitLabel("ollama")).toContain("Ollama");
  });
});
