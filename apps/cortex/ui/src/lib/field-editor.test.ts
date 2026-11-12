import { describe, expect, test } from "bun:test";
import { newSchemaField, outputSchemaTextOf, outputSchemaViewOf } from "./field-editor.js";

describe("output schema fields", () => {
  test("new fields get distinct names", () => {
    expect(newSchemaField([]).name).toBe("field");
    expect(newSchemaField([{ name: "field" }]).name).toBe("field2");
    expect(newSchemaField([{ name: "field" }, { name: "field2" }]).name).toBe("field3");
  });

  test("fields -> stored text -> view round-trips", () => {
    const rows = [
      { name: "city", type: "string", description: "Where", required: true },
      { name: "kind", type: "enum", enumValues: ["a", "b"], required: false },
    ] as const;
    const text = outputSchemaTextOf(rows);
    expect(JSON.parse(text)).toEqual({
      type: "object",
      properties: { city: { type: "string", description: "Where" }, kind: { type: "string", enum: ["a", "b"] } },
      required: ["city"],
    });
    const view = outputSchemaViewOf(text);
    expect(view.mode).toBe("fields");
    expect(view.fields).toEqual(rows);
  });

  test("no named field means no schema", () => {
    expect(outputSchemaTextOf([])).toBe("");
    expect(outputSchemaTextOf([{ name: " ", type: "string", required: false }])).toBe("");
  });

  test("the view says when the editor cannot show a schema", () => {
    expect(outputSchemaViewOf("").mode).toBe("empty");
    expect(outputSchemaViewOf("  ").mode).toBe("empty");
    expect(outputSchemaViewOf("{ nope").mode).toBe("invalid");
    expect(outputSchemaViewOf(JSON.stringify({ type: "array", items: { type: "string" } })).mode).toBe("json");
    expect(outputSchemaViewOf(JSON.stringify({ type: "object", properties: { a: { type: "object", properties: {} } } })).mode).toBe("json");
  });
});
