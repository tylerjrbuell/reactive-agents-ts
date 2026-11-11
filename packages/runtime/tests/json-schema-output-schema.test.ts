/**
 * JSON Schema as an output schema (engine/finalize/json-schema-contract.ts):
 *  - the deterministic validator agrees with Effect decoding on the schemas
 *    `JSONSchema.make` emits, and refuses keywords it cannot check;
 *  - `.withOutputSchema(jsonSchema)` works end to end and the schema
 *    round-trips through `toConfig()` / `agentConfigToBuilder()` /
 *    `agentConfigToSource()`.
 *
 * Run: bun test packages/runtime/tests/json-schema-output-schema.test.ts --timeout 20000
 */
import { describe, test, expect } from "bun:test";
import { Either, JSONSchema, Schema } from "effect";
import {
  isJsonSchemaObject,
  jsonSchemaValidator,
  toOutputSchemaContract,
  type JsonSchemaObject,
} from "../src/engine/finalize/json-schema-contract.js";
import { OutputSchemaError } from "../src/errors/structured-output-error.js";
import { ReactiveAgents } from "../src/builder.js";
import { agentConfigFromJSON, agentConfigToBuilder, agentConfigToJSON } from "../src/agent-config.js";
import { agentConfigToSource } from "../src/builder/config-source.js";

const CITY: JsonSchemaObject = {
  type: "object",
  properties: {
    city: { type: "string", minLength: 1 },
    population: { type: "integer", minimum: 0 },
    tags: { type: "array", items: { type: "string" }, uniqueItems: true },
    kind: { enum: ["capital", "town"] },
  },
  required: ["city"],
  additionalProperties: false,
};

const validate = (schema: JsonSchemaObject, value: unknown) => toOutputSchemaContract(schema).validate(value);

/** `JSONSchema.make` output as a plain JSON object (shallow copy; the values are untouched). */
const asJson = (schema: object): JsonSchemaObject => ({ ...schema });

describe("JSON Schema validator", () => {
  test("valid values pass; each failed assertion is an issue at its path", () => {
    expect(validate(CITY, { city: "Oslo", population: 700000, tags: ["a", "b"], kind: "capital" })).toEqual({
      ok: true,
      value: { city: "Oslo", population: 700000, tags: ["a", "b"], kind: "capital" },
    });
    const r = validate(CITY, { population: 1.5, tags: ["a", "a"], kind: "village", extra: 1 });
    expect(r.ok).toBe(false);
    const paths = r.ok ? [] : r.issues.map((i) => i.path.join("/"));
    expect(paths).toEqual(expect.arrayContaining(["city", "population", "tags", "kind", "extra"]));
  });

  test("agrees with Effect decoding on what JSONSchema.make emits", () => {
    const Inner = Schema.Struct({ x: Schema.Number }).annotations({ identifier: "Inner" });
    const S = Schema.Struct({
      s: Schema.String,
      i: Schema.Int,
      lit: Schema.Literal("a", "b"),
      arr: Schema.Array(Schema.String),
      opt: Schema.optional(Schema.String),
      nul: Schema.NullOr(Schema.Number),
      rec: Schema.Record({ key: Schema.String, value: Schema.Number }),
      inner: Inner,
      tup: Schema.Tuple(Schema.String, Schema.Number),
      nonEmpty: Schema.NonEmptyString,
      pos: Schema.Positive,
      uuid: Schema.UUID,
    });
    const json = asJson(JSONSchema.make(S));
    const good = {
      s: "x", i: 2, lit: "a", arr: ["q"], nul: null, rec: { k: 1 }, inner: { x: 1 }, tup: ["a", 1],
      nonEmpty: "n", pos: 3, uuid: "123e4567-e89b-12d3-a456-426614174000",
    };
    const cases: unknown[] = [
      good,
      { ...good, opt: "o" },
      { ...good, i: 2.5 },
      { ...good, lit: "c" },
      { ...good, nul: "x" },
      { ...good, rec: { k: "1" } },
      { ...good, inner: { x: "1" } },
      { ...good, tup: ["a"] },
      { ...good, tup: ["a", 1, 2] },
      { ...good, nonEmpty: "" },
      { ...good, pos: 0 },
      { ...good, uuid: "nope" },
      { ...good, extra: true },
      { ...good, s: undefined },
      [],
      null,
    ];
    const decode = Schema.decodeUnknownEither(S, { onExcessProperty: "error" });
    for (const value of cases) {
      expect({ value, ok: validate(json, value).ok }).toEqual({ value, ok: Either.isRight(decode(value)) });
    }
  });

  test("anyOf / oneOf / allOf / not / const / $ref via definitions", () => {
    const schema: JsonSchemaObject = {
      definitions: { Pos: { type: "number", exclusiveMinimum: 0 } },
      oneOf: [{ $ref: "#/definitions/Pos" }, { const: "none" }],
      not: { const: 13 },
    };
    expect(validate(schema, 4).ok).toBe(true);
    expect(validate(schema, "none").ok).toBe(true);
    expect(validate(schema, -1).ok).toBe(false);
    expect(validate(schema, 13).ok).toBe(false);
  });

  test("a keyword it cannot check is refused at set time, naming the keyword and path", () => {
    const bad = { type: "object", properties: { a: { type: "string", if: { minLength: 2 } } }, dependentRequired: {} };
    expect(() => jsonSchemaValidator(bad)).toThrow(OutputSchemaError);
    try {
      jsonSchemaValidator(bad);
    } catch (e) {
      expect((e as OutputSchemaError).message).toContain('unsupported keyword "if" at "/properties/a"');
      expect((e as OutputSchemaError).message).toContain('unsupported keyword "dependentRequired"');
    }
    expect(() => jsonSchemaValidator({ $ref: "https://example.com/s.json" })).toThrow(OutputSchemaError);
    expect(() => jsonSchemaValidator({ type: "strin" })).toThrow(OutputSchemaError);
    expect(() => jsonSchemaValidator({ pattern: "(" })).toThrow(OutputSchemaError);
  });

  test("toJsonSchema() returns the schema as given; the contract does not alias the caller's object", () => {
    const schema = structuredClone(CITY) as Record<string, unknown>;
    const contract = toOutputSchemaContract(schema);
    schema["type"] = "array";
    expect(contract.toJsonSchema()).toEqual(CITY);
    expect(contract.label).toBe("json-schema");
  });

  test("isJsonSchemaObject tells JSON Schema from Effect and Standard Schemas", () => {
    expect(isJsonSchemaObject(CITY)).toBe(true);
    expect(isJsonSchemaObject(Schema.Struct({ a: Schema.String }))).toBe(false);
    expect(isJsonSchemaObject({ "~standard": { version: 1 } })).toBe(false);
    expect(isJsonSchemaObject([])).toBe(false);
  });
});

describe("AgentConfig.outputSchema round-trip", () => {
  test("withOutputSchema(jsonSchema) -> toConfig -> JSON -> builder -> toConfig is lossless", async () => {
    const builder = ReactiveAgents.create()
      .withName("schema-rt")
      .withProvider("test")
      .withOutputSchema(CITY, { mode: "fast", onParseFail: "throw" });
    const config = builder.toConfig();
    expect(config.outputSchema).toEqual(CITY);
    expect(config.outputSchemaOptions).toEqual({ mode: "fast", onParseFail: "throw" });
    const again = (await agentConfigToBuilder(agentConfigFromJSON(agentConfigToJSON(config)))).toConfig();
    expect(again.outputSchema).toEqual(CITY);
    expect(again.outputSchemaOptions).toEqual(config.outputSchemaOptions);
  });

  test("an Effect schema is saved as its JSON Schema, which loads back and validates the same", async () => {
    const S = Schema.Struct({ city: Schema.String, rank: Schema.optional(Schema.Int) });
    const config = ReactiveAgents.create().withName("e").withProvider("test").withOutputSchema(S).toConfig();
    expect(config.outputSchema).toEqual(asJson(JSONSchema.make(S)));
    const reloaded = await agentConfigToBuilder(config);
    expect(reloaded.toConfig().outputSchema).toEqual(config.outputSchema);
  });

  test("a config with an unsupported schema keyword fails loudly when applied", async () => {
    await expect(
      agentConfigToBuilder({ name: "bad", provider: "test", outputSchema: { type: "object", if: {} } }),
    ).rejects.toThrow(/unsupported keyword "if"/);
  });

  test("agentConfigToSource prints withOutputSchema with the schema (field names are never redacted)", () => {
    const schema = { type: "object", properties: { headers: { type: "object" }, env: { type: "string" } } };
    const source = agentConfigToSource({ name: "src", provider: "test", outputSchema: schema, outputSchemaOptions: { mode: "fast" } });
    expect(source).toContain(".withOutputSchema(");
    expect(source).toContain('headers: { type: "object" }');
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("— no outputSchema in this config");
  });

  test("outputSchemaOptions without a schema still print as a comment and map to no call", () => {
    const source = agentConfigToSource({ name: "src", provider: "test", outputSchemaOptions: { mode: "fast" } });
    expect(source).not.toMatch(/^\s*\.withOutputSchema\(/m);
    expect(source).toContain("// .withOutputSchema(schema, ");
  });
});

describe("run() with a JSON Schema output schema", () => {
  test("result.object is the schema-valid value", async () => {
    const agent = await ReactiveAgents.create()
      .withName("json-run")
      .withTestScenario([{ text: '{"city":"Paris","population":2100000}' }])
      .withOutputSchema(CITY)
      .build();
    try {
      const result = await agent.run("Name a capital");
      expect(result.object).toEqual({ city: "Paris", population: 2100000 });
      expect(result.objectError).toBeUndefined();
    } finally {
      await agent.dispose();
    }
  }, 20000);
});
