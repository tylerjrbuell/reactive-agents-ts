import { describe, expect, test } from "bun:test";
import { parsePartialObject } from "../src/parse-partial.js";

describe("parsePartialObject", () => {
  test("parses complete JSON", () => {
    expect(parsePartialObject('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  test("parses truncated object (mid-stream)", () => {
    const partial = parsePartialObject('{"a":1,"b":"tru');
    expect(partial).toBeDefined();
    expect((partial as { a: number }).a).toBe(1);
  });

  test("parses truncated nested array", () => {
    const partial = parsePartialObject('{"items":[{"id":1},{"id":');
    expect(partial).toBeDefined();
  });

  test("returns empty object for non-JSON prose", () => {
    expect(parsePartialObject("hello world")).toEqual({});
  });
});
