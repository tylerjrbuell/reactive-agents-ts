// Pins the provider-agnostic tool-schema normalization boundary (Plan 1 Task 1).
// Built-in tool schemas cannot be imported here (@reactive-agents/tools depends
// on this package), so a representative fixture set of the built-in shapes is used.
import { describe, it, expect } from "bun:test";
import {
  normalizeToolSchema,
  isStrictCompatible,
  type ToolJSONSchema,
} from "../src/schema-utils.js";
import { toOpenAITool, toStrictToolSchema } from "../src/providers/openai.js";
import { toAnthropicTool } from "../src/providers/anthropic.js";
import { toGeminiTools } from "../src/providers/gemini.js";
import { toLiteLLMTool } from "../src/providers/litellm.js";
import { toOllamaTools } from "../src/providers/local.js";
import type { ToolDefinition } from "../src/types.js";

/** The observed Cortex failure: MCP array branch with no items inside anyOf. */
const observed = {
  type: "object",
  properties: { steps: { anyOf: [{ type: "array" }, { type: "string" }] } },
};

const wellFormed: Record<string, ToolJSONSchema> = {
  fileRead: {
    type: "object",
    properties: { path: { type: "string", description: "File path" } },
    required: ["path"],
  },
  webSearch: {
    type: "object",
    properties: {
      query: { type: "string" },
      maxResults: { type: "number", default: 5 },
      domains: { type: "array", items: { type: "string" } },
    },
    required: ["query"],
  },
  nested: {
    type: "object",
    properties: {
      opts: {
        type: "object",
        properties: { mode: { type: "string", enum: ["a", "b"] } },
        required: ["mode"],
      },
      rows: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } },
      either: { anyOf: [{ type: "string" }, { type: "array", items: { type: "number" } }] },
    },
  },
  noArgs: { type: "object", properties: {} },
  freeformMap: { type: "object", properties: { env: { type: "object", additionalProperties: { type: "string" } } } },
};

describe("normalizeToolSchema", () => {
  it("repairs the observed array-without-items inside anyOf with exactly one repair", () => {
    const { schema, repairs } = normalizeToolSchema(observed);
    expect(schema.properties?.steps?.anyOf?.[0]).toEqual({ type: "array", items: {} });
    expect(repairs).toEqual([{ path: "properties.steps.anyOf.0", kind: "array-items" }]);
  });

  it("does not mutate its input", () => {
    const copy = JSON.parse(JSON.stringify(observed));
    normalizeToolSchema(observed);
    expect(observed).toEqual(copy);
  });

  it("repairs at depth inside items, oneOf and allOf", () => {
    const { repairs } = normalizeToolSchema({
      type: "object",
      properties: {
        a: { type: "array", items: { type: "array" } },
        b: { oneOf: [{ type: "array" }] },
        c: { allOf: [{ type: "object" }] },
      },
    });
    expect(repairs.map((r) => `${r.path}:${r.kind}`).sort()).toEqual([
      "properties.a.items:array-items",
      "properties.b.oneOf.0:array-items",
      "properties.c.allOf.0:object-properties",
    ]);
  });

  it("converts type arrays to anyOf, moving structural keywords to the branch", () => {
    const { schema, repairs } = normalizeToolSchema({
      type: "object",
      properties: { x: { type: ["array", "null"], items: { type: "string" }, description: "d" } },
    });
    expect(schema.properties?.x).toEqual({
      description: "d",
      anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
    });
    expect(repairs).toEqual([{ path: "properties.x", kind: "type-array" }]);
  });

  it("drops empty required entries", () => {
    const { schema, repairs } = normalizeToolSchema({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a", ""],
    });
    expect(schema.required).toEqual(["a"]);
    expect(repairs).toEqual([{ path: "", kind: "required-pruned" }]);
  });

  it("wraps a non-object root and types a bare root", () => {
    const wrapped = normalizeToolSchema({ type: "string" });
    expect(wrapped.schema.type).toBe("object");
    expect(wrapped.schema.properties?.value).toEqual({ type: "string" });
    expect(wrapped.repairs).toEqual([{ path: "", kind: "root-object" }]);
    expect(normalizeToolSchema(undefined).schema).toEqual({ type: "object", properties: {} });
  });

  for (const [name, schema] of Object.entries(wellFormed)) {
    it(`is a deep-equal no-op for well-formed schema: ${name}`, () => {
      const { schema: out, repairs } = normalizeToolSchema(schema);
      expect(out).toEqual(schema);
      expect(repairs).toEqual([]);
    });
  }
});

describe("isStrictCompatible", () => {
  it("accepts fully typed schemas incl. anyOf of typed branches", () => {
    expect(isStrictCompatible(wellFormed.fileRead!)).toBe(true);
    expect(isStrictCompatible(wellFormed.nested!)).toBe(true);
  });
  it("rejects untyped nodes, bare items {}, open objects and banned keywords", () => {
    expect(isStrictCompatible(normalizeToolSchema(observed).schema)).toBe(false);
    expect(isStrictCompatible(wellFormed.freeformMap!)).toBe(false);
    expect(isStrictCompatible({ type: "object", properties: { a: { oneOf: [{ type: "string" }] } } })).toBe(false);
    expect(isStrictCompatible({ type: "object", properties: { a: { allOf: [{ type: "string" }] } } })).toBe(false);
    expect(isStrictCompatible({ type: "object", properties: { a: {} } })).toBe(false);
    expect(isStrictCompatible({ type: "string" })).toBe(false);
    // OpenAI docs: up to 10 levels of nesting, 5000 object properties.
    const nest = (d: number): Record<string, unknown> =>
      d === 0 ? { type: "string" } : { type: "object", properties: { c: nest(d - 1) } };
    expect(isStrictCompatible(nest(10) as never)).toBe(true);
    expect(isStrictCompatible(nest(11) as never)).toBe(false);
    const wide = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`p${i}`, { type: "string" }]));
    expect(isStrictCompatible({ type: "object", properties: wide })).toBe(false);
  });
});

describe("OpenAI strict handling", () => {
  const tool = (inputSchema: Record<string, unknown>): ToolDefinition => ({
    name: "umami_run_funnel",
    description: "d",
    inputSchema,
  });

  it("observed fixture: strict is dropped and parameters carry items", () => {
    const t = toOpenAITool(tool(observed), true);
    expect(t.function.strict).toBeUndefined();
    expect(t.function.parameters).toEqual({
      type: "object",
      properties: { steps: { anyOf: [{ type: "array", items: {} }, { type: "string" }] } },
    });
  });

  it("compatible schema keeps strict and strictifies every anyOf branch and nested items", () => {
    const t = toOpenAITool(
      tool({
        type: "object",
        properties: {
          pick: {
            anyOf: [
              { type: "object", properties: { a: { type: "string" } } },
              { type: "array", items: { type: "object", properties: { b: { type: "string" } } } },
            ],
          },
        },
        required: ["pick"],
      }),
      true,
    );
    expect(t.function.strict).toBe(true);
    const p = t.function.parameters as ToolJSONSchema;
    const branches = p.properties!.pick!.anyOf!;
    expect(branches[0]).toMatchObject({ additionalProperties: false, required: ["a"] });
    expect(branches[1]!.items).toMatchObject({ additionalProperties: false, required: ["b"] });
  });

  it("optional object property keeps its properties inside the nullable branch", () => {
    const out = toStrictToolSchema({
      type: "object",
      properties: { o: { type: "object", properties: { k: { type: "string" } } } },
    }) as ToolJSONSchema;
    expect(out.properties!.o!.anyOf![0]).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["k"],
    });
  });

  it("strict=false passes the normalized schema through", () => {
    const t = toOpenAITool(tool(wellFormed.webSearch!), false);
    expect(t.function.strict).toBeUndefined();
    expect(t.function.parameters).toEqual(wellFormed.webSearch);
  });
});

describe("every provider mapper sends the normalized schema", () => {
  const repaired = normalizeToolSchema(observed).schema;
  const def = { name: "umami_run_funnel", description: "d", inputSchema: observed as Record<string, unknown> };

  it("anthropic", () => {
    expect(toAnthropicTool(def).input_schema).toEqual(repaired);
  });
  it("gemini", () => {
    const out = toGeminiTools([def]);
    expect(out?.[0]?.functionDeclarations[0]?.parameters).toEqual(repaired);
  });
  it("litellm", () => {
    expect(toLiteLLMTool(def).function.parameters).toEqual(repaired);
  });
  it("ollama (local)", () => {
    expect(toOllamaTools([def])?.[0]?.function.parameters).toEqual(repaired);
  });
});
