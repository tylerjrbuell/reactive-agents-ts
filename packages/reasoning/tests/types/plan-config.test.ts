import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { PlanExecuteConfigSchema, defaultReasoningConfig } from "../../src/types/config.js";

describe("PlanExecuteConfig extensions", () => {
  it("accepts new planMode field", () => {
    const config = Schema.decodeSync(PlanExecuteConfigSchema)({
      maxRefinements: 1,
      reflectionDepth: "deep",
      planMode: "dag",
    });
    expect(config.planMode).toBe("dag");
  });

  it("accepts stepRetries and patchStrategy", () => {
    const config = Schema.decodeSync(PlanExecuteConfigSchema)({
      maxRefinements: 2,
      reflectionDepth: "shallow",
      stepRetries: 2,
      patchStrategy: "replan-remaining",
    });
    expect(config.stepRetries).toBe(2);
    expect(config.patchStrategy).toBe("replan-remaining");
  });

  it("defaults are backward compatible", () => {
    const config = defaultReasoningConfig.strategies.planExecute;
    expect(config.maxRefinements).toBe(2);
    expect(config.reflectionDepth).toBe("deep");
  });
});
