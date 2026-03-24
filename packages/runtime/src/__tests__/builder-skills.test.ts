import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../builder.js";

describe(".withSkills() builder", () => {
  it("accepts empty config", () => {
    const builder = ReactiveAgents.create().withProvider("test").withSkills();
    expect(builder).toBeDefined();
  });

  it("accepts custom paths and evolution config", () => {
    const builder = ReactiveAgents.create().withProvider("test").withSkills({
      paths: ["./custom-skills/"],
      evolution: { mode: "suggest", refinementThreshold: 10 },
    });
    expect(builder).toBeDefined();
  });

  it("accepts per-skill overrides", () => {
    const builder = ReactiveAgents.create().withProvider("test").withSkills({
      overrides: { "my-skill": { evolutionMode: "locked" } },
    });
    expect(builder).toBeDefined();
  });

  it("chains with other builder methods", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withSkills()
      .withReasoning()
      .withReactiveIntelligence();
    expect(builder).toBeDefined();
  });
});

describe("Extended .withReactiveIntelligence() hooks", () => {
  it("accepts onEntropyScored callback", () => {
    const builder = ReactiveAgents.create().withProvider("test")
      .withReactiveIntelligence({ onEntropyScored: () => {} });
    expect(builder).toBeDefined();
  });

  it("accepts constraints object", () => {
    const builder = ReactiveAgents.create().withProvider("test")
      .withReactiveIntelligence({
        constraints: { maxTemperatureAdjustment: 0.1, neverEarlyStop: true },
      });
    expect(builder).toBeDefined();
  });

  it("accepts autonomy level", () => {
    const builder = ReactiveAgents.create().withProvider("test")
      .withReactiveIntelligence({ autonomy: "observe" });
    expect(builder).toBeDefined();
  });

  it("still accepts boolean form", () => {
    const builder = ReactiveAgents.create().withProvider("test")
      .withReactiveIntelligence(false);
    expect(builder).toBeDefined();
  });

  it("still accepts plain RI config", () => {
    const builder = ReactiveAgents.create().withProvider("test")
      .withReactiveIntelligence({ controller: { earlyStop: true, contextCompression: false, strategySwitch: false } });
    expect(builder).toBeDefined();
  });
});
