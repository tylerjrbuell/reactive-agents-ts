import { describe, expect, test } from "bun:test";
import { parsePlanArg, planPrompt } from "./plan-command.js";

describe("parsePlanArg", () => {
  test("empty and show reveal the plan", () => {
    expect(parsePlanArg("")).toEqual({ kind: "show" });
    expect(parsePlanArg(" Show ")).toEqual({ kind: "show" });
  });
  test("hide hides it", () => expect(parsePlanArg("hide")).toEqual({ kind: "hide" }));
  test("anything else is a task, kept verbatim", () => {
    expect(parsePlanArg("research crypto prices")).toEqual({ kind: "task", task: "research crypto prices" });
    expect(parsePlanArg("hide the bugs in auth")).toEqual({ kind: "task", task: "hide the bugs in auth" });
  });
});

describe("planPrompt", () => {
  test("asks for to-do items, forbids acting, and carries the task", () => {
    const p = planPrompt("ship it");
    expect(p).toContain("`todo`");
    expect(p).toContain("do not carry out any step");
    expect(p).toContain("call no other tool");
    expect(p).toContain("Task: ship it");
  });
});
