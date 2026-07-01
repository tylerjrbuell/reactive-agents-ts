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

  it("replaces Python True/False/None with JSON equivalents", () => {
    const input = '{"enabled": True, "disabled": False, "value": None}';
    const result = JSON.parse(repairJson(input));
    expect(result.enabled).toBe(true);
    expect(result.disabled).toBe(false);
    expect(result.value).toBeNull();
  });

  it("strips single-line comments", () => {
    const input = '{\n  "name": "test", // this is a comment\n  "value": 1\n}';
    const result = JSON.parse(repairJson(input));
    expect(result.name).toBe("test");
    expect(result.value).toBe(1);
  });

  it("strips block comments", () => {
    const input = '{"name": /* comment */ "test"}';
    const result = JSON.parse(repairJson(input));
    expect(result.name).toBe("test");
  });

  it("replaces NaN with null", () => {
    const input = '{"value": NaN}';
    const result = JSON.parse(repairJson(input));
    expect(result.value).toBeNull();
  });

  it("replaces Infinity with null", () => {
    const input = '{"pos": Infinity, "neg": -Infinity}';
    const result = JSON.parse(repairJson(input));
    expect(result.pos).toBeNull();
    expect(result.neg).toBeNull();
  });

  it("converts Python/non-finite literals in VALUE position but preserves them inside string content", () => {
    // String-aware repair: `True`/`NaN` as bare JSON values are converted, but the
    // same tokens inside a legit double-quoted string value are DATA and must survive.
    const input = '{"title": "True Story", "co": "NaN Industries", "flag": True, "n": NaN}';
    const result = JSON.parse(repairJson(input));
    expect(result.title).toBe("True Story"); // string content preserved
    expect(result.co).toBe("NaN Industries"); // string content preserved
    expect(result.flag).toBe(true); // bare value converted
    expect(result.n).toBeNull(); // bare value converted
  });

  it("preserves Infinity/False inside string content", () => {
    const input = '{"name": "Infinity Ward", "verdict": "False positive", "b": False}';
    const result = JSON.parse(repairJson(input));
    expect(result.name).toBe("Infinity Ward");
    expect(result.verdict).toBe("False positive");
    expect(result.b).toBe(false);
  });

  it("preserves literals inside single-quoted string content (quote-normalized first)", () => {
    // Single quotes are normalized to double BEFORE literal fixing, so the
    // string span is recognized and its content survives.
    const input = "{'msg': 'True story', 'flag': True}";
    const result = JSON.parse(repairJson(input));
    expect(result.msg).toBe("True story");
    expect(result.flag).toBe(true);
  });
});
