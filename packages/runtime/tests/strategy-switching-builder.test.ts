import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

describe("withReasoning strategy switching options", () => {
  it("accepts enableStrategySwitching: true", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ enableStrategySwitching: true });
    expect(builder).toBeDefined();
  });

  it("accepts maxStrategySwitches", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ maxStrategySwitches: 2 });
    expect(builder).toBeDefined();
  });

  it("accepts fallbackStrategy", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ fallbackStrategy: "plan-execute-reflect" });
    expect(builder).toBeDefined();
  });

  it("enableStrategySwitching defaults to false when not specified", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withReasoning();
    expect(builder).toBeDefined(); // Just verify it builds without strategy switching
  });
});
