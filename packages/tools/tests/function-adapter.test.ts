import { Effect } from "effect";
import { describe, it, expect } from "bun:test";

import {
  adaptFunction,
  toFunctionCallingTool,
} from "../src/function-calling/function-adapter.js";
import {
  FILE_CONTENT_JSON_TYPES,
  toParameterJsonSchema,
} from "../src/function-calling/parameter-json-schema.js";
import { ToolParameterSchema, type ToolDefinition, type ToolParameter } from "../src/types.js";
import { codeExecuteTool } from "../src/skills/code-execution.js";
import { fileWriteTool } from "../src/skills/file-operations.js";

describe("Function Adapter", () => {
  it("should adapt a function to a tool definition + handler", async () => {
    const adapted = adaptFunction({
      name: "multiply",
      description: "Multiply two numbers",
      parameters: [
        {
          name: "a",
          type: "number",
          description: "First number",
          required: true,
        },
        {
          name: "b",
          type: "number",
          description: "Second number",
          required: true,
        },
      ],
      fn: (args) =>
        Effect.succeed((args.a as number) * (args.b as number)),
    });

    expect(adapted.definition.name).toBe("multiply");
    expect(adapted.definition.source).toBe("function");
    expect(adapted.definition.riskLevel).toBe("low");
    expect(adapted.definition.timeoutMs).toBe(30_000);

    const result = await Effect.runPromise(
      adapted.handler({ a: 3, b: 4 }),
    );
    expect(result).toBe(12);
  });

  it("should convert a tool definition to function calling format", () => {
    const fc = toFunctionCallingTool({
      name: "search",
      description: "Search query",
      parameters: [
        {
          name: "query",
          type: "string",
          description: "Search query",
          required: true,
        },
        {
          name: "limit",
          type: "number",
          description: "Max results",
          required: false,
        },
      ],
      riskLevel: "low",
      timeoutMs: 5000,
      requiresApproval: false,
      source: "builtin",
    });

    expect(fc.name).toBe("search");
    expect(fc.description).toBe("Search query");

    const schema = fc.input_schema as Record<string, unknown>;
    expect(schema).toHaveProperty("type", "object");

    const props = schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("query");
    expect(props).toHaveProperty("limit");

    const required = schema.required as string[];
    expect(required).toEqual(["query"]);
  });
});

// ToolParameter projection drift. Hand-picked field copies dropped `enum`,
// `items`, `additionalProperties` and `semantic` on the way to the model;
// toParameterJsonSchema is now the one projection. Every ToolParameter key is
// either carried (with the wire key that carries it) or excluded with a
// reason. Adding a key to ToolParameter fails the type check below until it is
// listed here, and the runtime check fails if the schema and this map diverge.
// RED-ON-CUT: drop a carried field from toParameterJsonSchema and the maximal
// case fails.
describe("ToolParameter projection drift", () => {
  const PROJECTION = {
    type: { carried: "type" },
    description: { carried: "description" },
    enum: { carried: "enum" },
    items: { carried: "items" },
    additionalProperties: { carried: "additionalProperties" },
    // Not a wire key of its own: "file-content" widens `type`.
    semantic: { carried: "type" },
    // The parent object schema's `properties` key.
    name: { excluded: "property key in the parent object schema" },
    // The parent object schema's `required` array.
    required: { excluded: "listed in the parent object schema's required array" },
    // Applied by the input validator when the model omits the value.
    default: { excluded: "applied by input-validator, not sent to the model" },
  } as const satisfies Record<keyof ToolParameter, { carried: string } | { excluded: string }>;

  it("the map covers exactly the ToolParameterSchema fields", () => {
    expect(Object.keys(PROJECTION).sort()).toEqual(Object.keys(ToolParameterSchema.fields).sort());
  });

  it("a maximal parameter carries every non-excluded field", () => {
    const p: ToolParameter = {
      name: "headers",
      type: "array",
      description: "d",
      required: true,
      default: [],
      items: { type: "object" },
      additionalProperties: { type: "string" },
      enum: ["a", "b"],
    };
    const wire: Readonly<Record<string, unknown>> = toParameterJsonSchema(p);
    for (const [key, rule] of Object.entries(PROJECTION)) {
      if ("carried" in rule) expect(wire[rule.carried]).toBeDefined();
      else expect(wire[key]).toBeUndefined();
    }
    expect(wire.items).toEqual({ type: "object" });
    expect(wire.enum).toEqual(["a", "b"]);
    expect(wire.additionalProperties).toEqual({ type: "string" });
  });

  it("file-content widens the type; arrays get default string items", () => {
    expect(
      toParameterJsonSchema({ name: "c", type: "string", description: "", required: true, semantic: "file-content" }).type,
    ).toEqual(["string", "object", "array", "number", "boolean"]);
    expect(toParameterJsonSchema({ name: "l", type: "array", description: "", required: false }).items).toEqual({
      type: "string",
    });
  });

  it("built-in enums and the file-write widening reach the function-calling schema", () => {
    const props = (t: ToolDefinition) =>
      (toFunctionCallingTool(t).input_schema as { properties: Record<string, { type: unknown; enum?: unknown }> })
        .properties;
    const lang = codeExecuteTool.parameters.find((p) => p.enum !== undefined);
    expect(lang).toBeDefined();
    if (lang) expect(props(codeExecuteTool)[lang.name]?.enum).toEqual(lang.enum);
    expect(props(fileWriteTool).content?.type).toEqual([...FILE_CONTENT_JSON_TYPES]);
  });
});
