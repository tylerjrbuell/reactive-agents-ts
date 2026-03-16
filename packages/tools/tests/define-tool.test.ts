// packages/tools/tests/define-tool.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { defineTool } from "../src/define-tool.js";

describe("defineTool", () => {
  it("should create a tool definition with correct metadata", () => {
    const tool = defineTool({
      name: "test-tool",
      description: "A test tool",
      input: Schema.Struct({
        query: Schema.String,
      }),
      handler: (args) => Effect.succeed(args.query),
    });

    expect(tool.definition.name).toBe("test-tool");
    expect(tool.definition.description).toBe("A test tool");
    expect(tool.definition.parameters).toHaveLength(1);
    expect(tool.definition.parameters[0]!.name).toBe("query");
    expect(tool.definition.parameters[0]!.type).toBe("string");
    expect(tool.definition.parameters[0]!.required).toBe(true);
  });

  it("should infer parameter types from Schema", () => {
    const tool = defineTool({
      name: "multi-param",
      description: "Multi param tool",
      input: Schema.Struct({
        name: Schema.String,
        count: Schema.Number,
        enabled: Schema.Boolean,
      }),
      handler: (args) => Effect.succeed(`${args.name}-${args.count}-${args.enabled}`),
    });

    expect(tool.definition.parameters).toHaveLength(3);
    const types = tool.definition.parameters.map(p => p.type);
    expect(types).toContain("string");
    expect(types).toContain("number");
    expect(types).toContain("boolean");
  });

  it("should handle optional parameters with defaults", () => {
    const tool = defineTool({
      name: "optional-tool",
      description: "Has optional params",
      input: Schema.Struct({
        required: Schema.String,
        optional: Schema.optional(Schema.Number),
      }),
      handler: (args) => Effect.succeed(args.required),
    });

    const params = tool.definition.parameters;
    const reqParam = params.find(p => p.name === "required")!;
    const optParam = params.find(p => p.name === "optional")!;
    expect(reqParam.required).toBe(true);
    expect(optParam.required).toBe(false);
  });

  it("should validate and parse args at runtime via handler wrapper", async () => {
    const tool = defineTool({
      name: "validated",
      description: "Validated tool",
      input: Schema.Struct({
        count: Schema.Number,
      }),
      handler: (args) => Effect.succeed(args.count * 2),
    });

    const result = await Effect.runPromise(tool.handler({ count: 5 }));
    expect(result).toBe(10);
  });

  it("should fail with validation error for invalid args", async () => {
    const tool = defineTool({
      name: "strict",
      description: "Strict tool",
      input: Schema.Struct({
        count: Schema.Number,
      }),
      handler: (args) => Effect.succeed(args.count),
    });

    const result = await Effect.runPromise(
      tool.handler({ count: "not-a-number" }).pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
  });

  it("should support custom options (riskLevel, timeout, category)", () => {
    const tool = defineTool({
      name: "risky",
      description: "High risk tool",
      input: Schema.Struct({ target: Schema.String }),
      handler: (args) => Effect.succeed(args.target),
      riskLevel: "high",
      timeoutMs: 60_000,
      category: "code",
      requiresApproval: true,
    });

    expect(tool.definition.riskLevel).toBe("high");
    expect(tool.definition.timeoutMs).toBe(60_000);
    expect(tool.definition.category).toBe("code");
    expect(tool.definition.requiresApproval).toBe(true);
  });

  it("should support enum constraints via Schema.Literal", () => {
    const tool = defineTool({
      name: "enum-tool",
      description: "Enum param tool",
      input: Schema.Struct({
        format: Schema.Literal("json", "csv", "text"),
      }),
      handler: (args) => Effect.succeed(args.format),
    });

    const formatParam = tool.definition.parameters.find(p => p.name === "format")!;
    expect(formatParam.enum).toEqual(["json", "csv", "text"]);
  });
});
