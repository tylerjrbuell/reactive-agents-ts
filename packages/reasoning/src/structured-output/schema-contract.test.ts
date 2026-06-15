import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
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
    if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
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
