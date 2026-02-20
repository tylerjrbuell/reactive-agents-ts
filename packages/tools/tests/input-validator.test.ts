import { Effect } from "effect";
import { describe, it, expect } from "bun:test";

import { validateToolInput } from "../src/validation/input-validator.js";
import type { ToolDefinition } from "../src/types.js";

const makeDef = (
  params: ToolDefinition["parameters"],
): ToolDefinition => ({
  name: "test-tool",
  description: "Test",
  parameters: params,
  riskLevel: "low",
  timeoutMs: 5000,
  requiresApproval: false,
  source: "function",
});

describe("validateToolInput", () => {
  it("should pass valid input", async () => {
    const def = makeDef([
      {
        name: "query",
        type: "string",
        description: "Query",
        required: true,
      },
    ]);

    const result = await Effect.runPromise(
      validateToolInput(def, { query: "hello" }),
    );
    expect(result).toEqual({ query: "hello" });
  });

  it("should fail on missing required parameter", async () => {
    const def = makeDef([
      {
        name: "query",
        type: "string",
        description: "Query",
        required: true,
      },
    ]);

    const error = await Effect.runPromise(
      validateToolInput(def, {}).pipe(Effect.flip),
    );
    expect(error._tag).toBe("ToolValidationError");
    expect(error.parameter).toBe("query");
  });

  it("should fail on type mismatch", async () => {
    const def = makeDef([
      {
        name: "count",
        type: "number",
        description: "Count",
        required: true,
      },
    ]);

    const error = await Effect.runPromise(
      validateToolInput(def, { count: "not-a-number" }).pipe(Effect.flip),
    );
    expect(error._tag).toBe("ToolValidationError");
    expect(error.expected).toBe("number");
    expect(error.received).toBe("string");
  });

  it("should fail on invalid enum value", async () => {
    const def = makeDef([
      {
        name: "color",
        type: "string",
        description: "Color",
        required: true,
        enum: ["red", "green", "blue"],
      },
    ]);

    const error = await Effect.runPromise(
      validateToolInput(def, { color: "purple" }).pipe(Effect.flip),
    );
    expect(error._tag).toBe("ToolValidationError");
    expect(error.received).toBe("purple");
  });

  it("should apply default values for optional parameters", async () => {
    const def = makeDef([
      {
        name: "limit",
        type: "number",
        description: "Limit",
        required: false,
        default: 10,
      },
    ]);

    const result = await Effect.runPromise(validateToolInput(def, {}));
    expect(result).toEqual({ limit: 10 });
  });

  it("should allow optional parameters to be omitted", async () => {
    const def = makeDef([
      {
        name: "extra",
        type: "string",
        description: "Extra",
        required: false,
      },
    ]);

    const result = await Effect.runPromise(validateToolInput(def, {}));
    expect(result).toEqual({});
  });

  it("should validate array types", async () => {
    const def = makeDef([
      {
        name: "items",
        type: "array",
        description: "Items",
        required: true,
      },
    ]);

    const result = await Effect.runPromise(
      validateToolInput(def, { items: [1, 2, 3] }),
    );
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it("should validate object types", async () => {
    const def = makeDef([
      {
        name: "data",
        type: "object",
        description: "Data",
        required: true,
      },
    ]);

    const result = await Effect.runPromise(
      validateToolInput(def, { data: { key: "value" } }),
    );
    expect(result).toEqual({ data: { key: "value" } });
  });
});
