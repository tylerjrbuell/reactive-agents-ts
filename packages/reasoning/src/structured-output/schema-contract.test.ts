import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { toSchemaContract } from "./schema-contract.js";

describe("toSchemaContract — Effect Schema", () => {
  const S = Schema.Struct({ total: Schema.Number, currency: Schema.String });
  it("validates a conforming value", () => {
    const c = toSchemaContract(S);
    const r = c.validate({ total: 42, currency: "USD" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.total).toBe(42);
  });
  it("rejects a non-conforming value with issues", () => {
    const c = toSchemaContract(S);
    const r = c.validate({ total: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.length).toBeGreaterThan(0);
      expect(r.issues[0].message.length).toBeGreaterThan(0);
    }
  });
  it("derives a JSON schema for native enforcement", () => {
    const c = toSchemaContract(S);
    const js = c.toJsonSchema();
    expect(js).toBeDefined();
    expect((js as Record<string, unknown>).type).toBe("object");
  });
  it("exposes the underlying effect schema", () => {
    const c = toSchemaContract(S);
    expect(c.effectSchema).toBe(S);
  });
});

describe("toSchemaContract — Standard Schema", () => {
  const std: StandardSchemaV1<unknown, { total: number }> = {
    "~standard": { version: 1, vendor: "test",
      validate: (value) => (typeof value === "object" && value !== null && typeof (value as { total?: unknown }).total === "number")
        ? { value: value as { total: number } }
        : { issues: [{ message: "total must be a number", path: ["total"] }] } },
  };
  it("validates via ~standard.validate", () => { const c = toSchemaContract(std); const r = c.validate({ total: 7 }); expect(r.ok).toBe(true); if (r.ok) expect(r.value.total).toBe(7); });
  it("reports issues from ~standard.validate", () => {
    const c = toSchemaContract(std);
    const r = c.validate({ total: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.length).toBeGreaterThan(0);
      expect(r.issues[0].message).toContain("total");
      expect(r.issues[0].path).toEqual(["total"]);
    }
  });
  it("returns undefined JSON schema when the validator has no emitter", () => { expect(toSchemaContract(std).toJsonSchema()).toBeUndefined(); });
  it("uses ~standard.jsonSchema.output when present (StandardJSONSchemaV1 extension)", () => {
    const stdWithJsonSchema: StandardSchemaV1<unknown, { total: number }> & {
      "~standard": StandardSchemaV1.Props<unknown, { total: number }> & {
        jsonSchema: { output: (opts: { target: string }) => Record<string, unknown> };
      };
    } = {
      "~standard": {
        ...std["~standard"],
        jsonSchema: {
          output: (_opts) => ({ type: "object", properties: { total: { type: "number" } } }),
        },
      },
    };
    const js = toSchemaContract(stdWithJsonSchema).toJsonSchema();
    expect(js).toBeDefined();
    expect((js as Record<string, unknown>).type).toBe("object");
  });
  it("surfaces an issue when ~standard.validate is async", () => {
    const asyncStd: StandardSchemaV1<unknown, unknown> = {
      "~standard": { version: 1, vendor: "test", validate: async (v) => ({ value: v }) },
    };
    const r = toSchemaContract(asyncStd).validate({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toContain("async");
  });
});
