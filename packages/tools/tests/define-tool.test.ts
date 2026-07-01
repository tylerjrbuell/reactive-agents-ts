// packages/tools/tests/define-tool.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { z } from "zod";
import * as v from "valibot";
import { defineTool } from "../src/define-tool.js";
import { ToolDefinitionError } from "../src/errors.js";

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

describe("defineTool — malformed options (typed errors, no TypeError crash)", () => {
  it("throws a typed ToolDefinitionError naming 'input' when caller passes 'parameters'", () => {
    // A first-time user's intuitive-but-wrong shape. Previously this crashed
    // with `TypeError: undefined is not an object (evaluating 'schema.ast')`.
    const bad = {
      name: "my-tool",
      description: "Wrong keys",
      parameters: [{ name: "a", type: "number", required: true }],
      execute: async () => 1,
    };
    let caught: unknown;
    try {
      // Bypass the compile-time contract the way a JS caller (or `as any` site)
      // would, to prove the RUNTIME guard fires instead of a raw TypeError.
      (defineTool as (o: unknown) => unknown)(bad);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ToolDefinitionError);
    const err = caught as ToolDefinitionError;
    expect(err.field).toBe("input");
    expect(err.toolName).toBe("my-tool");
    expect(err.message).toContain("input");
    expect(err.message).toContain("parameters");
    // Explicitly NOT a raw TypeError about schema.ast.
    expect(caught).not.toBeInstanceOf(TypeError);
  });

  it("throws a typed ToolDefinitionError naming 'handler' when caller passes 'execute'", () => {
    const bad = {
      name: "my-tool",
      description: "Wrong handler key",
      input: Schema.Struct({ a: Schema.Number }),
      execute: async () => 1,
    };
    let caught: unknown;
    try {
      (defineTool as (o: unknown) => unknown)(bad);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ToolDefinitionError);
    const err = caught as ToolDefinitionError;
    expect(err.field).toBe("handler");
    expect(err.message).toContain("handler");
    expect(err.message).toContain("execute");
  });

  it("throws a typed error (not TypeError) when options is not an object", () => {
    let caught: unknown;
    try {
      (defineTool as (o: unknown) => unknown)(null);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ToolDefinitionError);
  });
});

describe("defineTool — canonical plain-async handler", () => {
  it("accepts a plain async handler and normalises its result", async () => {
    const tool = defineTool({
      name: "greet",
      description: "Greet by name",
      input: Schema.Struct({ name: Schema.String }),
      handler: async (args) => `Hello, ${args.name}!`,
    });
    const result = await Effect.runPromise(tool.handler({ name: "Ada" }));
    expect(result).toBe("Hello, Ada!");
  });

  it("accepts a plain synchronous handler", async () => {
    const tool = defineTool({
      name: "double",
      description: "Double a number",
      input: Schema.Struct({ n: Schema.Number }),
      handler: (args) => args.n * 2,
    });
    const result = await Effect.runPromise(tool.handler({ n: 21 }));
    expect(result).toBe(42);
  });

  it("maps a thrown async handler error to ToolExecutionError", async () => {
    const tool = defineTool({
      name: "boom",
      description: "Always throws",
      input: Schema.Struct({ x: Schema.Number }),
      handler: async () => {
        throw new Error("kaboom");
      },
    });
    const result = await Effect.runPromise(tool.handler({ x: 1 }).pipe(Effect.either));
    expect(result._tag).toBe("Left");
  });

  it("still rejects invalid args before invoking the handler", async () => {
    let called = false;
    const tool = defineTool({
      name: "strict-async",
      description: "Strict",
      input: Schema.Struct({ n: Schema.Number }),
      handler: async () => {
        called = true;
        return "ok";
      },
    });
    const result = await Effect.runPromise(
      tool.handler({ n: "not-a-number" }).pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
    expect(called).toBe(false);
  });
});

describe("defineTool — Standard Schema (Zod)", () => {
  it("extracts parameter metadata from a Zod object schema", () => {
    const tool = defineTool({
      name: "zsearch",
      description: "Zod search",
      input: z.object({
        query: z.string(),
        limit: z.number().optional(),
        mode: z.enum(["fast", "slow"]),
        tags: z.array(z.string()),
      }),
      handler: async (args) => `${args.query}:${args.mode}`,
    });
    const byName = Object.fromEntries(
      tool.definition.parameters.map((p) => [p.name, p]),
    );
    expect(byName.query!.type).toBe("string");
    expect(byName.query!.required).toBe(true);
    expect(byName.limit!.type).toBe("number");
    expect(byName.limit!.required).toBe(false);
    expect(byName.mode!.enum).toEqual(["fast", "slow"]);
    expect(byName.tags!.type).toBe("array");
  });

  it("validates and runs via the Zod ~standard interface", async () => {
    const tool = defineTool({
      name: "zadd",
      description: "Add via Zod",
      input: z.object({ a: z.number(), b: z.number() }),
      handler: async (args) => args.a + args.b,
    });
    const ok = await Effect.runPromise(tool.handler({ a: 2, b: 3 }));
    expect(ok).toBe(5);
    const bad = await Effect.runPromise(
      tool.handler({ a: "x", b: 3 }).pipe(Effect.either),
    );
    expect(bad._tag).toBe("Left");
  });
});

describe("defineTool — Standard Schema (Valibot)", () => {
  it("extracts parameter metadata from a Valibot object schema", () => {
    const tool = defineTool({
      name: "vsearch",
      description: "Valibot search",
      input: v.object({
        query: v.string(),
        limit: v.optional(v.number()),
        mode: v.picklist(["fast", "slow"]),
      }),
      handler: async (args) => args.query,
    });
    const byName = Object.fromEntries(
      tool.definition.parameters.map((p) => [p.name, p]),
    );
    expect(byName.query!.type).toBe("string");
    expect(byName.query!.required).toBe(true);
    expect(byName.limit!.required).toBe(false);
    expect(byName.mode!.enum).toEqual(["fast", "slow"]);
  });

  it("validates and runs via the Valibot ~standard interface", async () => {
    const tool = defineTool({
      name: "vgreet",
      description: "Greet via Valibot",
      input: v.object({ name: v.string() }),
      handler: async (args) => `Hi ${args.name}`,
    });
    const ok = await Effect.runPromise(tool.handler({ name: "Bo" }));
    expect(ok).toBe("Hi Bo");
    const bad = await Effect.runPromise(
      tool.handler({ name: 123 }).pipe(Effect.either),
    );
    expect(bad._tag).toBe("Left");
  });
});
