import { describe, it, expect } from "bun:test";
import { parsePartialObject } from "../src/parse-partial.js";

describe("parsePartialObject", () => {
  it("parses a complete JSON object", () => {
    expect(parsePartialObject('{"a":1,"b":"hello"}')).toEqual({ a: 1, b: "hello" });
  });

  it("returns partial object when value is truncated mid-key", () => {
    // '{"a":1,"b":' — b's value is missing; only a should be recovered
    const result = parsePartialObject('{"a":1,"b":');
    expect(result).toEqual({ a: 1 });
  });

  it("strips markdown ```json fences", () => {
    expect(parsePartialObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("strips bare ``` fences", () => {
    expect(parsePartialObject("```\n{\"a\":1}\n```")).toEqual({ a: 1 });
  });

  it("skips leading prose and finds the JSON object", () => {
    expect(parsePartialObject('Here is the output: {"a":1}')).toEqual({ a: 1 });
  });

  it("returns {} for garbage input", () => {
    expect(parsePartialObject("not json at all")).toEqual({});
  });

  it("returns {} for empty string", () => {
    expect(parsePartialObject("")).toEqual({});
  });

  it("returns {} for a bare array (not an object)", () => {
    expect(parsePartialObject("[1,2,3]")).toEqual({});
  });

  it("handles nested objects in a partial stream", () => {
    // incomplete nested object — outer key should still be recovered
    const result = parsePartialObject('{"outer":{"inner":42},"next":');
    expect((result as { outer?: { inner: number } }).outer).toEqual({ inner: 42 });
  });

  it("handles a complete but whitespace-heavy string", () => {
    expect(parsePartialObject('  { "x" : 99 }  ')).toEqual({ x: 99 });
  });
});
