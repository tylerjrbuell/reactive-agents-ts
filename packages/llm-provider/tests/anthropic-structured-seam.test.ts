// Seam pin: ../src/providers/anthropic-structured.ts — the forced-tool schema
// enforcement helpers behind AnthropicProviderLive.completeStructured().
//
// Run: bun test packages/llm-provider/tests/anthropic-structured-seam.test.ts --timeout 15000

import { describe, it, expect } from "bun:test";
import { JSONSchema, Schema } from "effect";
import {
  ANTHROPIC_STRUCTURED_TOOL_NAME,
  anthropicStructuredToolFields,
  structuredToolInputJson,
  toAnthropicStructuredTool,
} from "../src/providers/anthropic-structured.js";

describe("toAnthropicStructuredTool", () => {
  it("uses an object schema as the tool input_schema, without the $schema marker", () => {
    const { tool, wrapped } = toAnthropicStructuredTool(
      JSONSchema.make(Schema.Struct({ city: Schema.String, temp: Schema.Number })),
    );
    expect(wrapped).toBe(false);
    expect(tool.name).toBe(ANTHROPIC_STRUCTURED_TOOL_NAME);
    expect(tool.input_schema.type).toBe("object");
    expect(tool.input_schema.properties).toEqual({
      city: { type: "string" },
      temp: { type: "number" },
    });
    expect(tool.input_schema.required).toEqual(["city", "temp"]);
    expect("$schema" in tool.input_schema).toBe(false);
  });

  it("inlines a root $ref and keeps $defs at the root", () => {
    class Point extends Schema.Class<Point>("Point")({ x: Schema.Number, y: Schema.Number }) {}
    const source = JSONSchema.make(Point) as Record<string, unknown>;
    expect(typeof source.$ref).toBe("string");

    const { tool, wrapped } = toAnthropicStructuredTool(source);
    expect(wrapped).toBe(false);
    expect(tool.input_schema.type).toBe("object");
    expect("$ref" in tool.input_schema).toBe(false);
    expect(Object.keys(tool.input_schema.properties as object)).toEqual(["x", "y"]);
    expect(tool.input_schema.$defs).toEqual(source.$defs);
  });

  it("wraps a non-object root as the required value property", () => {
    const { tool, wrapped } = toAnthropicStructuredTool(
      JSONSchema.make(Schema.Array(Schema.String)),
    );
    expect(wrapped).toBe(true);
    expect(tool.input_schema).toEqual({
      type: "object",
      properties: { value: { type: "array", items: { type: "string" } } },
      required: ["value"],
    });
  });
});

describe("anthropicStructuredToolFields", () => {
  it("forces exactly the structured tool", () => {
    const structured = toAnthropicStructuredTool(JSONSchema.make(Schema.Struct({ a: Schema.Number })));
    expect(anthropicStructuredToolFields(structured)).toEqual({
      tools: [structured.tool],
      tool_choice: { type: "tool", name: ANTHROPIC_STRUCTURED_TOOL_NAME },
    });
  });
});

describe("structuredToolInputJson", () => {
  const call = (input: unknown) => ({
    type: "tool_use",
    id: "t1",
    name: ANTHROPIC_STRUCTURED_TOOL_NAME,
    input,
  });

  it("returns the structured tool input as JSON", () => {
    expect(structuredToolInputJson([call({ a: 1 })], false)).toBe('{"a":1}');
  });

  it("unwraps value for a wrapped schema", () => {
    expect(structuredToolInputJson([call({ value: ["x", "y"] })], true)).toBe('["x","y"]');
  });

  it("is undefined when the structured tool was not called", () => {
    expect(structuredToolInputJson([{ type: "text", text: "{}" }], false)).toBeUndefined();
    expect(
      structuredToolInputJson([{ type: "tool_use", id: "t2", name: "other", input: {} }], false),
    ).toBeUndefined();
    expect(structuredToolInputJson([call({ notValue: 1 })], true)).toBeUndefined();
  });
});
