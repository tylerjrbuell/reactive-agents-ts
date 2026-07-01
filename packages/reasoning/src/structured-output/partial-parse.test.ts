import { describe, it, expect } from "bun:test";
import { parsePartial } from "./partial-parse.js";

describe("parsePartial", () => {
  it("parses a complete object", () => {
    expect(parsePartial('{"a":1,"b":2}')).toEqual({ a: 1, b: 2 });
  });

  it("parses a prefix mid-object (drops the dangling key/colon)", () => {
    expect(parsePartial('{"a":1,"b":')).toEqual({ a: 1 });
  });

  it("parses a prefix mid-string value (drops the partial string value)", () => {
    // Chosen behavior: DROP the partial string value entry — the key/colon/partial-string
    // is after the last stable comma, so lastStableCut rewinds to after "a":1.
    const r = parsePartial('{"a":1,"name":"Par');
    expect(r.a).toBe(1);
    // "name" key is incomplete — we drop it rather than include a truncated string.
    expect(r.name).toBeUndefined();
  });

  it("parses nested arrays/objects with open brackets", () => {
    const r = parsePartial('{"a":1,"items":[{"x":');
    expect(r.a).toBe(1);
    expect(Array.isArray(r.items)).toBe(true);
  });

  it("returns {} for an unparseable / non-object head", () => {
    expect(parsePartial("not json")).toEqual({});
    expect(parsePartial("")).toEqual({});
  });

  it("handles a complete nested object", () => {
    expect(parsePartial('{"a":1,"b":{"c":3}}')).toEqual({ a: 1, b: { c: 3 } });
  });

  it("handles partial nested object — keeps stable outer fields", () => {
    const r = parsePartial('{"a":1,"b":{"c":');
    expect(r.a).toBe(1);
    // "b" key started but its value is incomplete — behavior can be either:
    // drop "b" (lastStableCut after "a":1) or include "b":{} (closed up).
    // Either is acceptable; assert only that "a" is present.
    expect(typeof r).toBe("object");
  });

  it("handles an array value that is complete", () => {
    const r = parsePartial('{"tags":["a","b"],"n":5}');
    expect(r.tags).toEqual(["a", "b"]);
    expect(r.n).toBe(5);
  });

  it("handles null and boolean values", () => {
    expect(parsePartial('{"ok":true,"x":null}')).toEqual({ ok: true, x: null });
  });

  it("handles a truncated top-level bracket with no stable cut", () => {
    // Only "{" — nothing parseable yet
    const r = parsePartial("{");
    expect(r).toEqual({});
  });

  it("strips ```json fences", () => {
    expect(parsePartial('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("skips leading prose before the object", () => {
    expect(parsePartial('Here is the result: {"a":1,"b":2}')).toEqual({ a: 1, b: 2 });
  });

  it("handles fenced partial mid-stream", () => {
    const r = parsePartial('```json\n{"total":4200,"currency":');
    expect(r.total).toBe(4200);
  });

  it("parses a large object (well past MAX_WALKBACK) truncated mid last value", () => {
    // 200 complete fields then a dangling key/value. The latest stable cut is the
    // comma after k199, which parses on the first Tier-1 attempt — the walkback
    // bound must not drop the completed prefix.
    const N = 200;
    const complete = Array.from({ length: N }, (_, i) => `"k${i}":${i}`).join(",");
    const r = parsePartial(`{${complete},"k${N}":`);
    expect(r.k0).toBe(0);
    expect(r[`k${N - 1}`]).toBe(N - 1);
    expect(r[`k${N}`]).toBeUndefined(); // dangling last field dropped
  });
});
