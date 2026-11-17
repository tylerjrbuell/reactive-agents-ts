import { describe, expect, test } from "bun:test";
import { extrasChip, toggleId, toolControl } from "./plan-row.js";

const steps = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("toolControl", () => {
  test("a step with a tool shows the pick list", () => {
    expect(toolControl("file-write", false)).toBe("select");
  });
  test("no tool: a quiet add until revealed, then the pick list", () => {
    expect(toolControl(undefined, false)).toBe("add");
    expect(toolControl("", false)).toBe("add");
    expect(toolControl(undefined, true)).toBe("select");
  });
});

describe("extrasChip", () => {
  test("a step with neither is the quiet affordance", () => {
    expect(extrasChip(steps, undefined)).toEqual({ label: "deps / args", set: false });
    expect(extrasChip(steps, {})).toEqual({ label: "deps / args", set: false });
    expect(extrasChip(steps, { dependsOn: [] })).toEqual({ label: "deps / args", set: false });
  });
  test("prerequisites and args read by position, joined", () => {
    expect(extrasChip(steps, { dependsOn: ["a"] })).toEqual({ label: "after 1", set: true });
    expect(extrasChip(steps, { args: { q: 1 } })).toEqual({ label: "args", set: true });
    expect(extrasChip(steps, { dependsOn: ["a", "b"], args: { q: 1 } })).toEqual({ label: "after 1, 2 · args", set: true });
  });
});

describe("toggleId", () => {
  test("adds an absent id and removes a present one, keeping the rest", () => {
    expect(toggleId([], "a")).toEqual(["a"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleId(["b"], "a")).toEqual(["b", "a"]);
  });
});
