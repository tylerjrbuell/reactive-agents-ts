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

  it("should apply default for required parameters when omitted", async () => {
    // required:true + default means "must be present; if the model omits it,
    // fall back to the default". Previously the required check fired before
    // the default could apply, making the combination contradictory.
    const def = makeDef([
      {
        name: "count",
        type: "number",
        description: "Count",
        required: true,
        default: 25,
      },
    ]);

    const result = await Effect.runPromise(validateToolInput(def, {}));
    expect(result).toEqual({ count: 25 });
  });

  it("should apply default for required parameters when null", async () => {
    const def = makeDef([
      {
        name: "count",
        type: "number",
        description: "Count",
        required: true,
        default: 25,
      },
    ]);

    const result = await Effect.runPromise(
      validateToolInput(def, { count: null }),
    );
    expect(result).toEqual({ count: 25 });
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

  it("should coerce comma-separated string to array for array params", async () => {
    const def = makeDef([
      {
        name: "coins",
        type: "array",
        items: { type: "string" },
        description: "Coin symbols",
        required: true,
      },
    ]);

    const result = await Effect.runPromise(
      validateToolInput(def, { coins: "BTC,ETH,XRP" }),
    );
    expect(result).toEqual({ coins: ["BTC", "ETH", "XRP"] });
  });

  it("should coerce single-item string to array for array params", async () => {
    const def = makeDef([
      {
        name: "coins",
        type: "array",
        items: { type: "string" },
        description: "Coin symbols",
        required: true,
      },
    ]);

    const result = await Effect.runPromise(
      validateToolInput(def, { coins: "BTC" }),
    );
    expect(result).toEqual({ coins: ["BTC"] });
  });

  it("should coerce stringified boolean 'true'/'false' for boolean params", async () => {
    // Repro: qwen3.5 / cogito emit `"full": "true"` instead of `"full": true`.
    // Surfaced in Phase-A context-stress bench 2026-06-01 — recall tool dropped
    // the `full` flag on every call from local-tier models.
    const def = makeDef([
      { name: "full", type: "boolean", description: "Full mode", required: false },
    ]);
    expect(await Effect.runPromise(validateToolInput(def, { full: "true" }))).toEqual({ full: true });
    expect(await Effect.runPromise(validateToolInput(def, { full: "false" }))).toEqual({ full: false });
    expect(await Effect.runPromise(validateToolInput(def, { full: "TRUE" }))).toEqual({ full: true });
  });

  it("should reject non-canonical strings for boolean params", async () => {
    const def = makeDef([
      { name: "full", type: "boolean", description: "Full mode", required: false },
    ]);
    const error = await Effect.runPromise(
      validateToolInput(def, { full: "yes" }).pipe(Effect.flip),
    );
    expect(error._tag).toBe("ToolValidationError");
    expect(error.expected).toBe("boolean");
  });

  it("should coerce stringified number for number params", async () => {
    const def = makeDef([
      { name: "limit", type: "number", description: "Limit", required: true },
    ]);
    expect(await Effect.runPromise(validateToolInput(def, { limit: "5" }))).toEqual({ limit: 5 });
    expect(await Effect.runPromise(validateToolInput(def, { limit: "-3.14" }))).toEqual({ limit: -3.14 });
  });

  it("should still reject non-numeric strings for number params", async () => {
    // Preserves the existing fail-on-typo behavior.
    const def = makeDef([
      { name: "count", type: "number", description: "Count", required: true },
    ]);
    const error = await Effect.runPromise(
      validateToolInput(def, { count: "not-a-number" }).pipe(Effect.flip),
    );
    expect(error._tag).toBe("ToolValidationError");
    expect(error.expected).toBe("number");
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
