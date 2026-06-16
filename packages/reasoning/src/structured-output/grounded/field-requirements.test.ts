import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { fieldRequirementsFromSchema, fieldRequirementsFromJsonSchema, missingRequiredFields } from "./field-requirements.js";

describe("field-requirements", () => {
  const S = Schema.Struct({ total: Schema.Number, note: Schema.optional(Schema.String) });
  it("lists required (non-optional) top-level fields", () => {
    const reqs = fieldRequirementsFromSchema(S);
    const required = reqs.filter((r) => r.required).map((r) => r.path);
    expect(required).toEqual(["total"]);
    expect(reqs.map((r) => r.path).sort()).toEqual(["note", "total"]);
  });
  it("computes missing required fields from a partial object", () => {
    const reqs = fieldRequirementsFromSchema(S);
    expect(missingRequiredFields(reqs, {})).toEqual(["total"]);
    expect(missingRequiredFields(reqs, { total: 5 })).toEqual([]);
    expect(missingRequiredFields(reqs, { total: null })).toEqual(["total"]); // null counts as missing
  });
  it("returns [] for a non-struct schema", () => {
    expect(fieldRequirementsFromSchema(Schema.String)).toEqual([]);
  });
});

describe("fieldRequirementsFromJsonSchema", () => {
  it("reads properties + required from a JSON schema", () => {
    const js = { type: "object", properties: { total: { type: "number" }, note: { type: "string" } }, required: ["total"] };
    const reqs = fieldRequirementsFromJsonSchema(js);
    expect(reqs.find(r => r.path === "total")?.required).toBe(true);
    expect(reqs.find(r => r.path === "note")?.required).toBe(false);
    expect(reqs.map(r => r.path).sort()).toEqual(["note", "total"]);
  });
  it("returns [] when no properties", () => {
    expect(fieldRequirementsFromJsonSchema({ type: "string" })).toEqual([]);
  });
  it("handles missing required array (all optional)", () => {
    const reqs = fieldRequirementsFromJsonSchema({ type: "object", properties: { a: {} } });
    expect(reqs).toEqual([{ path: "a", required: false }]);
  });
});
