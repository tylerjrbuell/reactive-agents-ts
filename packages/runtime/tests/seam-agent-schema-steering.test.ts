import { describe, it, expect } from "bun:test";
import type { SchemaContract } from "@reactive-agents/reasoning";
import { buildSchemaSteering } from "../src/agent/schema-steering.js";

const contractOf = (schema: unknown): SchemaContract<unknown> =>
  ({ toJsonSchema: () => schema }) as unknown as SchemaContract<unknown>;

describe("buildSchemaSteering", () => {
  it("steers object schemas to a single JSON object and embeds the schema", () => {
    const out = buildSchemaSteering(contractOf({ type: "object", properties: { a: { type: "string" } } }));
    expect(out).toContain("single JSON object");
    expect(out).toContain('"properties"');
  });

  it("steers top-level array schemas to a JSON array, not a wrapping object", () => {
    const out = buildSchemaSteering(contractOf({ type: "array", items: { type: "string" } }));
    expect(out).toContain("JSON array");
    expect(out).toContain("no wrapping object");
  });

  it("omits the schema block when the contract has no JSON schema", () => {
    const out = buildSchemaSteering(contractOf(undefined));
    expect(out).toContain("single JSON object");
    expect(out).not.toContain("{");
  });
});
