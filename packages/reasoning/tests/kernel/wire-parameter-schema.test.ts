import { describe, it, expect } from "bun:test";
import { buildWireParameterSchema } from "../../src/kernel/capabilities/reason/wire-parameter-schema.js";

describe("buildWireParameterSchema", () => {
  it("forwards additionalProperties when present", () => {
    const w = buildWireParameterSchema(
      { name: "headers", type: "object", description: "h", additionalProperties: { type: "string" } },
      false,
    );
    expect(w.additionalProperties).toEqual({ type: "string" });
  });
  it("omits additionalProperties when absent", () => {
    const w = buildWireParameterSchema({ name: "u", type: "string", description: "d" }, false);
    expect("additionalProperties" in w).toBe(false);
  });
  it("keeps compact-profile + array behavior", () => {
    const w = buildWireParameterSchema({ name: "a", type: "array", description: "d" }, true);
    expect(w).toEqual({ type: "array", items: { type: "string" } });
  });
});
