import { describe, expect, it } from "bun:test";
import {
  adaptiveChoiceLine,
  adaptiveChoiceOf,
  foldStrategyRun,
  initialStrategyRun,
  planProgressOf,
  planSummaryOf,
  strategyRunForStorage,
  strategyRunFromStorage,
  strategyStepFromWire,
  strategyStepOf,
  type StrategyRunState,
} from "../src/index.js";

const fold = (steps: readonly [string, { note?: string }?][]): StrategyRunState =>
  steps.reduce((s, [pass, d]) => foldStrategyRun(s, strategyStepOf(pass, d ?? {})!), initialStrategyRun);

describe("adaptiveChoiceOf", () => {
  it("reads the heuristic pick, the classifier pick, the skip default, a cost downgrade and a fallback", () => {
    expect(adaptiveChoiceOf(fold([["adaptive:heuristic", { note: "[ADAPTIVE] Heuristic: blueprint" }]]))).toEqual({ chosen: "blueprint", how: "heuristic" });
    expect(adaptiveChoiceOf(fold([["adaptive:select", { note: "[ADAPTIVE] Selected strategy: plan-execute-reflect" }]]))).toEqual({ chosen: "plan-execute-reflect", how: "classifier" });
    expect(adaptiveChoiceOf(fold([["adaptive:classifier-skip"]]))).toEqual({ chosen: "reactive", how: "default" });
    expect(
      adaptiveChoiceOf(fold([["adaptive:select", { note: "[ADAPTIVE] Selected strategy: tree-of-thought" }], ["adaptive:cost-downgrade", { note: "[ADAPTIVE] cost-downgrade tree-of-thought→reactive" }]])),
    ).toEqual({ chosen: "reactive", how: "cheaper", from: "tree-of-thought" });
    expect(adaptiveChoiceOf(fold([["adaptive:select", { note: "[ADAPTIVE] Selected strategy: reflexion" }], ["adaptive:fallback"]]))).toEqual({ chosen: "reactive", how: "fallback" });
  });

  it("is undefined for a run that never ran adaptive, or whose rows name nothing", () => {
    expect(adaptiveChoiceOf(fold([["reflexion:generate"]]))).toBeUndefined();
    expect(adaptiveChoiceOf(fold([["adaptive:select"]]))).toBeUndefined();
  });

  it("words the choice with the strategy's display name", () => {
    expect(adaptiveChoiceLine({ chosen: "plan-execute-reflect", how: "classifier" })).toBe("chose Plan, execute, reflect (by classifier)");
  });

  it("the note survives the wire and storage", () => {
    const step = strategyStepFromWire({ kind: "strategy-step", pass: "adaptive:select", note: "[ADAPTIVE] Selected strategy: reactive" })!;
    const run = foldStrategyRun(initialStrategyRun, step);
    expect(run.rows[0]!.note).toContain("reactive");
    const back = strategyRunFromStorage(JSON.parse(JSON.stringify(strategyRunForStorage(run))));
    expect(adaptiveChoiceOf(back!)).toEqual({ chosen: "reactive", how: "classifier" });
  });
});

describe("planProgressOf / planSummaryOf", () => {
  it("counts steps, failures and plan revisions", () => {
    const run = fold([["plan-execute:plan-1"], ["plan-execute:step-1:done"], ["plan-execute:step-2:failed"], ["plan-execute:refine-1"], ["plan-execute:step-3:retry-1"]]);
    expect(planProgressOf(run)).toEqual({ steps: 3, done: 1, failed: 1, retrying: 1, revisions: 1, retries: 1, patched: 0 });
    expect(planSummaryOf(run)).toBe("3 steps, 1 failed, 1 retry, plan revised");
  });

  it("is undefined before any step ran", () => {
    expect(planSummaryOf(fold([["blueprint:plan"]]))).toBeUndefined();
  });
});
