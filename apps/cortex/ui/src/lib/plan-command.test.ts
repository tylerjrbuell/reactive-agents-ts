import { describe, expect, test } from "bun:test";
import { parsePlanArg, EXECUTE_MESSAGE } from "./plan-command.js";

describe("parsePlanArg", () => {
  test("empty switches the session to plan mode", () => {
    expect(parsePlanArg("")).toEqual({ kind: "mode" });
    expect(parsePlanArg("  ")).toEqual({ kind: "mode" });
  });
  test("show and hide drive the to-do dock", () => {
    expect(parsePlanArg(" Show ")).toEqual({ kind: "show" });
    expect(parsePlanArg("hide")).toEqual({ kind: "hide" });
  });
  test("anything else is a task, kept verbatim", () => {
    expect(parsePlanArg("research crypto prices")).toEqual({ kind: "task", task: "research crypto prices" });
    expect(parsePlanArg("hide the bugs in auth")).toEqual({ kind: "task", task: "hide the bugs in auth" });
  });
});

describe("EXECUTE_MESSAGE", () => {
  test("is the plain follow-up the plan card sends", () => {
    expect(EXECUTE_MESSAGE).toBe("Execute the plan.");
  });
});
