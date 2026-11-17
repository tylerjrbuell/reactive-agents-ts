import { describe, expect, test } from "bun:test";
import { argsText, dependsLabel, extrasEdited, extrasOfSteps, hasExtras, parseArgsText, planProblem, pruneExtras, setArgs, setDependsOn, toggleDependsOn, type WireStep } from "./plan-extras.js";
import { PLAN_STRATEGY_OPTIONS, choiceOfValue, executorOf, strategyNote, usesPlanExecutor } from "./plan-strategy.js";

const steps: WireStep[] = [
  { id: "a", title: "Search", status: "pending", args: { query: "x" } },
  { id: "b", title: "Write", status: "pending", dependsOn: ["a"] },
  { id: "c", title: "Check", status: "pending" },
];

describe("plan extras map", () => {
  test("reads the extras the wire steps carry and nothing for plain ones", () => {
    expect(extrasOfSteps(steps)).toEqual({ a: { args: { query: "x" } }, b: { dependsOn: ["a"] } });
    expect(hasExtras(extrasOfSteps([{ id: "c", title: "C", status: "pending" }]))).toBe(false);
  });

  test("set, toggle and clear keep the map minimal", () => {
    const e = setDependsOn({}, "b", ["a"]);
    expect(e).toEqual({ b: { dependsOn: ["a"] } });
    expect(toggleDependsOn(e, "b", "c")).toEqual({ b: { dependsOn: ["a", "c"] } });
    expect(toggleDependsOn(e, "b", "a")).toEqual({});
    expect(setArgs(e, "b", { k: 1 })).toEqual({ b: { dependsOn: ["a"], args: { k: 1 } } });
    expect(setArgs({ b: { args: { k: 1 } } }, "b", undefined)).toEqual({});
  });

  test("edited: same content is not an edit, a changed dependency is", () => {
    expect(extrasEdited({ b: { dependsOn: ["a"] } }, { b: { dependsOn: ["a"] } })).toBe(false);
    expect(extrasEdited({ b: { dependsOn: ["a"] } }, { b: { dependsOn: ["c"] } })).toBe(true);
    expect(extrasEdited({}, { a: { args: { q: 1 } } })).toBe(true);
  });

  test("prune drops a removed step's entry and prerequisites on it; returns the same map when nothing changes", () => {
    const e = extrasOfSteps(steps);
    expect(pruneExtras(e, steps)).toBe(e);
    expect(pruneExtras(e, steps.filter((s) => s.id !== "a"))).toEqual({});
    expect(pruneExtras({ c: { dependsOn: ["a", "b"] } }, steps.filter((s) => s.id !== "a"))).toEqual({ c: { dependsOn: ["b"] } });
  });
});

describe("args text", () => {
  test("blank clears; an object parses; arrays, scalars and broken JSON are refused", () => {
    expect(parseArgsText("  ")).toEqual({ ok: true, args: undefined });
    expect(parseArgsText('{"q": 1}')).toEqual({ ok: true, args: { q: 1 } });
    expect(parseArgsText("[1]")).toMatchObject({ ok: false });
    expect(parseArgsText("3")).toMatchObject({ ok: false });
    expect(parseArgsText("{oops")).toMatchObject({ ok: false, error: "Args must be valid JSON." });
  });
  test("the field shows pretty JSON, or nothing", () => {
    expect(argsText({ q: 1 })).toBe('{\n  "q": 1\n}');
    expect(argsText(undefined)).toBe("");
  });
});

describe("planProblem (core's findPlanDependencyProblem)", () => {
  test("sound graph: none", () => expect(planProblem(steps, extrasOfSteps(steps))).toBeUndefined());
  test("unknown id, self reference and cycle are named in the framework's words", () => {
    expect(planProblem(steps, { b: { dependsOn: ["zzz"] } })).toContain('unknown step "zzz"');
    expect(planProblem(steps, { b: { dependsOn: ["b"] } })).toContain("depends on itself");
    expect(planProblem(steps, { a: { dependsOn: ["b"] }, b: { dependsOn: ["a"] } })).toContain("cycle");
  });
  test("dependsLabel numbers prerequisites by position", () => {
    expect(dependsLabel(steps, ["a", "c"])).toBe("after 1, 3");
    expect(dependsLabel(steps, undefined)).toBe("");
  });
});

describe("execute strategy picker", () => {
  test("Auto omits the strategy; a named one is passed; unknown values read as Auto", () => {
    expect(executorOf("auto")).toBeUndefined();
    expect(executorOf("blueprint")).toBe("blueprint");
    expect(choiceOfValue("nope")).toBe("auto");
    expect(choiceOfValue("plan-execute-reflect")).toBe("plan-execute-reflect");
    expect(PLAN_STRATEGY_OPTIONS[0]?.value).toBe("auto");
  });
  test("Auto goes through the executor only when steps carry dependencies or args", () => {
    expect(usesPlanExecutor("auto", {})).toBe(false);
    expect(usesPlanExecutor("auto", { b: { dependsOn: ["a"] } })).toBe(true);
    expect(usesPlanExecutor("blueprint", {})).toBe(true);
    expect(strategyNote("auto", {})).toContain("usual Execute turn");
  });
});
