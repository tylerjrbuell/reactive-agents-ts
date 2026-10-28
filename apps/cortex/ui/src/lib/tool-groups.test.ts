import { expect, test } from "bun:test";
import { groupToolNames } from "./tool-groups.js";

test("repeated tools collapse to one keyed entry with a count, in first-seen order", () => {
  expect(groupToolNames(["a/get", "b/run", "a/get"])).toEqual([
    { name: "a/get", count: 2 },
    { name: "b/run", count: 1 },
  ]);
  expect(groupToolNames([])).toEqual([]);
});
