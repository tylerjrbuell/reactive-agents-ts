import { describe, expect, test } from "bun:test";
import {
  fieldRowsOf,
  fieldsToJsonSchema,
  finishTurnTrace,
  foldStructured,
  foldTurnTrace,
  initialTurnTrace,
  jsonSchemaToFields,
  obtainedOf,
  pointerLabel,
  type StructuredOutputReportWire,
  type UiStreamEvent,
} from "../src/index.js";

const report = (over: Partial<StructuredOutputReportWire> = {}): StructuredOutputReportWire => ({
  outcome: "success",
  layer: "native",
  native: "succeeded",
  attempts: 1,
  promptAttempts: 0,
  repairs: [],
  coerced: false,
  budgetEscalated: false,
  fieldErrors: [],
  ...over,
});

const completed = (extra: Partial<Extract<UiStreamEvent, { _tag: "StreamCompleted" }>> = {}): UiStreamEvent => ({
  _tag: "StreamCompleted",
  output: "{}",
  metadata: {},
  ...extra,
});

describe("foldStructured", () => {
  test("a report event sets the report; the latest wins", () => {
    const a = foldStructured(undefined, { _tag: "StructuredOutputReported", taskId: "t", report: report() });
    const b = foldStructured(a, { _tag: "StructuredOutputReported", taskId: "t", report: report({ attempts: 3 }) });
    expect(b?.report?.attempts).toBe(3);
  });

  test("completion carries object, error and report; a plain completion changes nothing", () => {
    expect(foldStructured(undefined, completed({ object: { a: 1 }, objectReport: report() }))).toEqual({ object: { a: 1 }, report: report() });
    expect(foldStructured(undefined, completed({ objectError: "no json" }))).toEqual({ error: "no json" });
    const prior = { object: { a: 1 } };
    expect(foldStructured(prior, completed())).toBe(prior);
    expect(foldStructured(prior, { _tag: "TextDelta", text: "x" })).toBe(prior);
  });

  test("the turn trace folds and persists it; a trace with only structured output is kept", () => {
    const s = [
      { _tag: "StructuredOutputReported", taskId: "t", report: report({ layer: "repaired", repairs: ["trailing-commas"] }) },
      completed({ object: { city: "Oslo" } }),
    ].reduce(foldTurnTrace, initialTurnTrace());
    expect(s.structured?.object).toEqual({ city: "Oslo" });
    expect(s.structured?.report?.layer).toBe("repaired");
    const persisted = finishTurnTrace(s);
    expect(persisted?.structured?.object).toEqual({ city: "Oslo" });
    expect(finishTurnTrace(initialTurnTrace())).toBeUndefined();
  });
});

describe("fieldRowsOf", () => {
  const schema = {
    type: "object",
    properties: { name: { type: "string", description: "Full name" }, age: { type: "integer" } },
  };

  test("follows schema order, then extra keys; carries descriptions", () => {
    const rows = fieldRowsOf({ extra: true, age: 4, name: "Ada" }, schema);
    expect(rows.map((r) => r.label)).toEqual(["name", "age", "extra"]);
    expect(rows[0]).toMatchObject({ pointer: "/name", display: "Ada", kind: "string", description: "Full name", depth: 0 });
    expect(rows[1]).toMatchObject({ kind: "number", display: "4" });
    expect(rows[2]).toMatchObject({ kind: "boolean", display: "true" });
  });

  test("expands nested objects and arrays of objects, escapes pointers, joins scalar lists", () => {
    const rows = fieldRowsOf({ "a/b": { c: 1 }, tags: ["x", "y"], items: [{ n: 1 }] });
    expect(rows.map((r) => [r.pointer, r.depth, r.display])).toEqual([
      ["/a~1b", 0, ""],
      ["/a~1b/c", 1, "1"],
      ["/tags", 0, "x, y"],
      ["/items", 0, "1 items"],
      ["/items/0", 1, ""],
      ["/items/0/n", 2, "1"],
    ]);
  });

  test("marks the rows whose field failed", () => {
    const rows = fieldRowsOf({ age: "old" }, schema, [{ path: "/age", message: "expected integer" }]);
    expect(rows[0]?.error).toBe("expected integer");
  });

  test("a scalar root is one row; null and undefined do not crash", () => {
    expect(fieldRowsOf("hi")).toEqual([{ pointer: "", label: "value", depth: 0, kind: "string", display: "hi" }]);
    expect(fieldRowsOf(undefined)).toEqual([]);
    expect(fieldRowsOf({ a: null })[0]).toMatchObject({ kind: "null", display: "null" });
  });

  test("a huge object is capped", () => {
    const big = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));
    expect(fieldRowsOf(big).length).toBe(200);
  });
});

describe("pointerLabel", () => {
  test("reads a pointer as a dotted path", () => {
    expect(pointerLabel("")).toBe("the whole answer");
    expect(pointerLabel("/a/b~1c/0")).toBe("a.b/c.0");
  });
});

describe("obtainedOf", () => {
  test("a native success is ok", () => {
    const v = obtainedOf(report());
    expect(v.tone).toBe("ok");
    expect(v.layer).toContain("schema-constrained");
    expect(v.facts).toContainEqual({ label: "Provider-native call", value: "succeeded" });
  });

  test("a repaired success names each repair and needs attention", () => {
    const v = obtainedOf(report({ layer: "repaired", native: "failed", attempts: 2, promptAttempts: 1, repairs: ["trailing-commas", "single-quotes"] }));
    expect(v.tone).toBe("attention");
    expect(v.repairs).toEqual(["Removed trailing commas", "Changed single quotes to double quotes"]);
    expect(v.facts).toContainEqual({ label: "Model requests", value: "2 (1 in prompt mode)" });
  });

  test("a retried or coerced success needs attention; coercion and budget are facts", () => {
    expect(obtainedOf(report({ layer: "retried" })).tone).toBe("attention");
    const v = obtainedOf(report({ layer: "coerced", coerced: true, budgetEscalated: true }));
    expect(v.facts.map((f) => f.label)).toEqual(["Provider-native call", "Model requests", "Output budget", "Coerced"]);
  });

  test("a failure lists field errors as pointers and readable paths", () => {
    const v = obtainedOf(
      report({
        outcome: "failure",
        layer: null,
        fieldErrors: [{ path: "/address/zip", message: "required" }, { path: "", message: "expected object" }],
        failure: { kind: "schema-mismatch", message: "2 errors" },
      }),
    );
    expect(v.tone).toBe("bad");
    expect(v.fieldErrors).toEqual([
      { pointer: "/address/zip", field: "address.zip", message: "required" },
      { pointer: "", field: "the whole answer", message: "expected object" },
    ]);
    expect(v.failure).toEqual({ kind: "The JSON parsed but did not match the schema.", message: "2 errors" });
  });

  test("no report: an error is a failure, none means the answer validated as written", () => {
    expect(obtainedOf(undefined, "boom").failure?.message).toBe("boom");
    expect(obtainedOf(undefined).tone).toBe("ok");
  });
});

describe("schema fields", () => {
  const fields = [
    { name: "city", type: "string", description: "Where", required: true },
    { name: "pop", type: "integer", required: false },
    { name: "kind", type: "enum", enumValues: ["a", "b"], required: true },
    { name: "tags", type: "string[]", required: false },
    { name: "scores", type: "number[]", required: false },
    { name: "ok", type: "boolean", required: false },
  ] as const;

  test("fields -> JSON Schema -> fields round-trips exactly", () => {
    const schema = fieldsToJsonSchema(fields);
    expect(schema).toEqual({
      type: "object",
      properties: {
        city: { type: "string", description: "Where" },
        pop: { type: "integer" },
        kind: { type: "string", enum: ["a", "b"] },
        tags: { type: "array", items: { type: "string" } },
        scores: { type: "array", items: { type: "number" } },
        ok: { type: "boolean" },
      },
      required: ["city", "kind"],
    });
    const back = jsonSchemaToFields(schema);
    expect(back.exact).toBe(true);
    expect(back.fields).toEqual(fields);
  });

  test("blank and repeated names are skipped; an empty list is an empty object schema", () => {
    expect(fieldsToJsonSchema([{ name: " ", type: "string", required: true }])).toEqual({ type: "object", properties: {} });
    const s = fieldsToJsonSchema([{ name: "a", type: "string", required: false }, { name: "a", type: "number", required: true }]) as { properties: Record<string, unknown>; required?: string[] };
    expect(s.properties.a).toEqual({ type: "string" });
    expect(s.required).toBeUndefined();
  });

  test("a schema the editor cannot express reads inexact so a UI keeps the JSON", () => {
    expect(jsonSchemaToFields({ type: "object", properties: { a: { type: "object", properties: {} } } }).exact).toBe(false);
    expect(jsonSchemaToFields({ type: "object", properties: { a: { type: "string" } }, additionalProperties: false }).exact).toBe(false);
    expect(jsonSchemaToFields({ type: "array", items: { type: "string" } })).toEqual({ fields: [], exact: false });
    expect(jsonSchemaToFields(null)).toEqual({ fields: [], exact: false });
  });

  test("required order does not matter", () => {
    const r = jsonSchemaToFields({ type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["b", "a"] });
    expect(r.exact).toBe(true);
  });
});
