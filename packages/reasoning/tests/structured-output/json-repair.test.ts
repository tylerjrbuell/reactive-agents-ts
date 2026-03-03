import { describe, it, expect } from "bun:test";
import { extractJsonBlock, repairJson } from "../../src/structured-output/json-repair.js";

describe("extractJsonBlock", () => {
  it("extracts JSON from markdown code fences", () => {
    const input = 'Here is the plan:\n```json\n{"steps": [{"title": "A"}]}\n```\nDone.';
    expect(extractJsonBlock(input)).toBe('{"steps": [{"title": "A"}]}');
  });

  it("extracts first { ... } block from mixed text", () => {
    const input = 'Sure! {"steps": []} is the plan.';
    expect(extractJsonBlock(input)).toBe('{"steps": []}');
  });

  it("handles nested braces correctly", () => {
    const input = '{"steps": [{"args": {"a": 1}}]}';
    expect(extractJsonBlock(input)).toBe('{"steps": [{"args": {"a": 1}}]}');
  });

  it("extracts array blocks", () => {
    const input = 'Result: [{"id": 1}, {"id": 2}]';
    expect(extractJsonBlock(input)).toBe('[{"id": 1}, {"id": 2}]');
  });

  it("returns null when no JSON found", () => {
    expect(extractJsonBlock("No JSON here")).toBeNull();
  });
});

describe("repairJson", () => {
  it("fixes trailing commas", () => {
    const input = '{"steps": [{"title": "A",},]}';
    const result = JSON.parse(repairJson(input));
    expect(result.steps[0].title).toBe("A");
  });

  it("fixes single quotes to double quotes", () => {
    const input = "{'steps': [{'title': 'A'}]}";
    const result = JSON.parse(repairJson(input));
    expect(result.steps[0].title).toBe("A");
  });

  it("closes unclosed braces (truncated JSON)", () => {
    const input = '{"steps": [{"title": "A"';
    const repaired = repairJson(input);
    const result = JSON.parse(repaired);
    expect(result.steps[0].title).toBe("A");
  });

  it("closes unclosed brackets (truncated array)", () => {
    const input = '{"steps": [{"title": "A"}';
    const repaired = repairJson(input);
    const result = JSON.parse(repaired);
    expect(result.steps[0].title).toBe("A");
  });

  it("handles unescaped newlines in strings", () => {
    const input = '{"instruction": "line 1\nline 2"}';
    const repaired = repairJson(input);
    const result = JSON.parse(repaired);
    expect(result.instruction).toContain("line 1");
  });

  it("returns valid JSON unchanged", () => {
    const input = '{"steps": []}';
    expect(repairJson(input)).toBe(input);
  });
});
