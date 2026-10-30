import { describe, expect, test } from "bun:test";
import { parsePlanArg, GO_MESSAGE } from "./plan-command.js";

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

describe("GO_MESSAGE", () => {
  test("is a plain continuation message, not a prompt wrapper", () => {
    expect(GO_MESSAGE).toBe("Go ahead with the plan.");
  });
});
