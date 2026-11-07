import { describe, it, expect } from "bun:test";
import { repairedJson } from "../src/attribution-refusal.js";

// The instrument's repairability check behind harness:refused-repairable. It
// may only insert backslashes or drop trailing closers: the repaired text with
// those removed must equal the input, and it must parse.

const stripInserted = (s: string): string => s.replace(/\\"/g, '"');

describe("repairedJson (content-preserving JSON repair check)", () => {
  it("escapes a quoted phrase copied into a string value", () => {
    const bad = '[{"id": "Q1", "question": "What is the "component model", what does it add?", "answer": "a"}]';
    const r = repairedJson(bad);
    expect(r).toBeDefined();
    expect(stripInserted(r!)).toBe(bad);
    expect(JSON.parse(r!)[0].question).toBe('What is the "component model", what does it add?');
  });

  it("keeps the structure: keys and values land where they were written", () => {
    const bad = '{"a": "say "hi" now", "b": [1, 2], "c": "x"}';
    expect(JSON.parse(repairedJson(bad)!)).toEqual({ a: 'say "hi" now', b: [1, 2], c: "x" });
  });

  it("drops surplus closing brackets", () => {
    expect(repairedJson('[{"id": 1}]]')).toBe('[{"id": 1}]');
  });

  it("does not invent missing closers (a truncated value is not repairable)", () => {
    expect(repairedJson('[{"id": "Q1", "answer": "forty-two"')).toBeUndefined();
  });

  it("does not count content that already parses", () => {
    expect(repairedJson('{"ok": true}')).toBeUndefined();
  });

  it("does not repair prose", () => {
    expect(repairedJson("Here is the JSON you asked for.")).toBeUndefined();
  });
});
