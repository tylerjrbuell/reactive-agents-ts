import { describe, expect, it } from "bun:test";
import { foldRunStrategy, initialRunStrategy, runStrategyOf, runStrategyOfEvents, strategyClaimsOf } from "../src/index.js";

const ev = (type: string, payload: Record<string, unknown>) => ({ type, payload });

describe("run strategy: one rule for every reader", () => {
  it("the resolved run config outranks step and loop events, whatever arrives first", () => {
    const r = runStrategyOfEvents([
      ev("ReasoningStepCompleted", { strategy: "structured-output-native" }),
      ev("AgentStarted", { config: { builder: { strategy: "plan-execute-reflect" } } }),
      ev("ReasoningIterationProgress", { iteration: 1, strategy: "reactive" }),
    ]);
    expect(r).toEqual({ strategy: "plan-execute-reflect" });
  });

  it("without a config strategy, the kernel loop outranks a step event's label", () => {
    const r = runStrategyOfEvents([
      ev("AgentStarted", { config: { builder: {} } }),
      ev("ReasoningStepCompleted", { strategy: "structured-output-native" }),
      ev("ReasoningIterationProgress", { iteration: 1, strategy: "reactive" }),
      ev("ReasoningIterationProgress", { iteration: 2, strategy: "reflexion" }),
    ]);
    expect(r).toEqual({ strategy: "reactive" });
  });

  it("first-seen wins within a rank; a step event alone still names the strategy", () => {
    expect(runStrategyOfEvents([ev("ReasoningStepCompleted", { strategy: "a" }), ev("ReasoningStepCompleted", { strategy: "b" })])).toEqual({ strategy: "a" });
  });

  it("a switch reports the last strategy; the run's own report beats a switch", () => {
    const switched = [
      ev("ReasoningIterationProgress", { iteration: 1, strategy: "reactive" }),
      ev("StrategySwitched", { from: "reactive", to: "plan-execute-reflect" }),
      ev("StrategySwitched", { from: "plan-execute-reflect", to: "reflexion" }),
    ];
    expect(runStrategyOfEvents(switched)).toEqual({ strategy: "reactive", switchedTo: "reflexion" });
    expect(runStrategyOfEvents([...switched, ev("StreamCompleted", { metadata: { strategyUsed: "plan-execute-reflect" } })])).toEqual({
      strategy: "reactive",
      switchedTo: "plan-execute-reflect",
    });
  });

  it("an ended strategy equal to the started one is not a switch", () => {
    expect(runStrategyOfEvents([ev("AgentStarted", { config: { builder: { strategy: "reactive" } } }), ev("StreamCompleted", { metadata: { strategyUsed: "reactive" } })])).toEqual({ strategy: "reactive" });
  });

  it("events that name no strategy leave the state untouched", () => {
    expect(foldRunStrategy(initialRunStrategy, "LLMRequestCompleted", { strategy: "x" })).toBe(initialRunStrategy);
    expect(strategyClaimsOf("AgentStarted", { config: "nope" })).toEqual({});
    expect(runStrategyOf(initialRunStrategy)).toEqual({});
  });
});
