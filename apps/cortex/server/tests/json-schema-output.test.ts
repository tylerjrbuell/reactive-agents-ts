// Run: bun test apps/cortex/server/tests/json-schema-output.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { jsonSchemaToStandardSchema } from "../services/json-schema-output.js";
import { buildCortexAgent } from "../services/build-cortex-agent.js";

const schema = {
  type: "object",
  properties: { name: { type: "string" }, score: { type: "number" } },
  required: ["name"],
};

describe("jsonSchemaToStandardSchema", () => {
  it("exposes the JSON Schema via the StandardJSONSchemaV1 extension", () => {
    const std = jsonSchemaToStandardSchema(schema) as unknown as {
      "~standard": { jsonSchema: { output: () => unknown }; validate: (v: unknown) => unknown };
    };
    expect(std["~standard"].jsonSchema.output()).toEqual(schema);
  });

  it("lenient validate accepts an object, rejects a primitive", () => {
    const std = jsonSchemaToStandardSchema(schema) as unknown as {
      "~standard": { validate: (v: unknown) => { value?: unknown; issues?: unknown[] } };
    };
    expect(std["~standard"].validate({ name: "x" }).issues).toBeUndefined();
    expect(std["~standard"].validate("nope").issues).toBeDefined();
  });

  it("top-level array schema accepts arrays", () => {
    const arrStd = jsonSchemaToStandardSchema({ type: "array", items: { type: "string" } }) as unknown as {
      "~standard": { validate: (v: unknown) => { issues?: unknown[] } };
    };
    expect(arrStd["~standard"].validate(["a", "b"]).issues).toBeUndefined();
    expect(arrStd["~standard"].validate({}).issues).toBeDefined();
  });
});

describe("buildCortexAgent — structured output enabler", () => {
  it("builds with an outputSchema without throwing", async () => {
    const agent = await buildCortexAgent({ provider: "test", agentId: "so-1", outputSchema: schema });
    expect(agent.agentId).toBe("so-1");
  });
});
