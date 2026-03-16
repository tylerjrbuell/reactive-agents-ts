/**
 * Schema validation tests — verify Effect Schema definitions for
 * PromptVariable, PromptTemplate, and CompiledPrompt.
 */
import { describe, test, expect } from "bun:test";
import { Schema } from "effect";
import {
  PromptVariableSchema,
  PromptTemplateSchema,
  CompiledPromptSchema,
  PromptVariableType,
} from "../src/types/template.js";

// ─── PromptVariableType ───

describe("PromptVariableType schema", () => {
  const decode = Schema.decodeUnknownSync(PromptVariableType);

  test("accepts valid types", () => {
    expect(decode("string")).toBe("string");
    expect(decode("number")).toBe("number");
    expect(decode("boolean")).toBe("boolean");
    expect(decode("array")).toBe("array");
    expect(decode("object")).toBe("object");
  });

  test("rejects invalid type", () => {
    expect(() => decode("invalid")).toThrow();
  });

  test("rejects non-string", () => {
    expect(() => decode(42)).toThrow();
  });
});

// ─── PromptVariableSchema ───

describe("PromptVariableSchema", () => {
  const decode = Schema.decodeUnknownSync(PromptVariableSchema);

  test("decodes minimal required variable", () => {
    const v = decode({ name: "task", required: true, type: "string" });
    expect(v.name).toBe("task");
    expect(v.required).toBe(true);
    expect(v.type).toBe("string");
  });

  test("decodes variable with all optional fields", () => {
    const v = decode({
      name: "count",
      required: false,
      type: "number",
      description: "Number of items",
      defaultValue: 10,
    });
    expect(v.description).toBe("Number of items");
    expect(v.defaultValue).toBe(10);
  });

  test("rejects variable without name", () => {
    expect(() => decode({ required: true, type: "string" })).toThrow();
  });

  test("rejects variable without required field", () => {
    expect(() => decode({ name: "x", type: "string" })).toThrow();
  });

  test("rejects variable with invalid type", () => {
    expect(() => decode({ name: "x", required: true, type: "map" })).toThrow();
  });
});

// ─── PromptTemplateSchema ───

describe("PromptTemplateSchema", () => {
  const decode = Schema.decodeUnknownSync(PromptTemplateSchema);

  test("decodes minimal template", () => {
    const tpl = decode({
      id: "test.tpl",
      name: "Test",
      version: 1,
      template: "Hello {{name}}",
      variables: [{ name: "name", required: true, type: "string" }],
    });
    expect(tpl.id).toBe("test.tpl");
    expect(tpl.variables.length).toBe(1);
  });

  test("decodes template with metadata", () => {
    const tpl = decode({
      id: "test.meta",
      name: "Meta Test",
      version: 2,
      template: "Content",
      variables: [],
      metadata: {
        author: "tester",
        description: "A test template",
        tags: ["test", "demo"],
        model: "gpt-4",
        maxTokens: 4096,
      },
    });
    expect(tpl.metadata?.author).toBe("tester");
    expect(tpl.metadata?.tags).toEqual(["test", "demo"]);
    expect(tpl.metadata?.maxTokens).toBe(4096);
  });

  test("decodes template with experimentId", () => {
    const tpl = decode({
      id: "test.exp",
      name: "Exp Test",
      version: 1,
      template: "Content",
      variables: [],
      experimentId: "exp-42",
    });
    expect(tpl.experimentId).toBe("exp-42");
  });

  test("decodes template with empty variables array", () => {
    const tpl = decode({
      id: "test.empty",
      name: "Empty",
      version: 1,
      template: "No vars",
      variables: [],
    });
    expect(tpl.variables).toEqual([]);
  });

  test("rejects template without id", () => {
    expect(() =>
      decode({ name: "X", version: 1, template: "x", variables: [] }),
    ).toThrow();
  });

  test("rejects template without version", () => {
    expect(() =>
      decode({ id: "x", name: "X", template: "x", variables: [] }),
    ).toThrow();
  });
});

// ─── CompiledPromptSchema ───

describe("CompiledPromptSchema", () => {
  const decode = Schema.decodeUnknownSync(CompiledPromptSchema);

  test("decodes a valid compiled prompt", () => {
    const cp = decode({
      templateId: "test.tpl",
      version: 1,
      content: "Hello world",
      tokenEstimate: 3,
      variables: { name: "world" },
    });
    expect(cp.templateId).toBe("test.tpl");
    expect(cp.version).toBe(1);
    expect(cp.content).toBe("Hello world");
    expect(cp.tokenEstimate).toBe(3);
    expect(cp.variables).toEqual({ name: "world" });
  });

  test("decodes with empty variables", () => {
    const cp = decode({
      templateId: "x",
      version: 1,
      content: "x",
      tokenEstimate: 1,
      variables: {},
    });
    expect(cp.variables).toEqual({});
  });

  test("rejects missing content", () => {
    expect(() =>
      decode({ templateId: "x", version: 1, tokenEstimate: 1, variables: {} }),
    ).toThrow();
  });
});
