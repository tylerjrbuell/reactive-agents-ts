import { describe, expect, test } from "bun:test";
import { formatTaskContextLines, parseTaskContextLines } from "./task-context-lines.js";

describe("task-context-lines", () => {
  test("parseTaskContextLines reads key=value rows", () => {
    expect(parseTaskContextLines("a=1\nb=two")).toEqual({ a: "1", b: "two" });
  });

  test("formatTaskContextLines round-trips with parse", () => {
    const o = { x: "y", z: "w" };
    expect(parseTaskContextLines(formatTaskContextLines(o))).toEqual(o);
  });
});
