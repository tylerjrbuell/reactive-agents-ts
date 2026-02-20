import { Effect } from "effect";
import { describe, it, expect } from "bun:test";

import {
  adaptFunction,
  toFunctionCallingTool,
} from "../src/function-calling/function-adapter.js";

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
