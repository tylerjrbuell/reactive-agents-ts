import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { defineTool } from "../src/define-tool.js";

describe("defineTool output schema", () => {
  it("passes through a value matching the output schema", async () => {
    const t = defineTool({
      name: "get-user",
      description: "Fetch a user",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ id: Schema.String, name: Schema.String }),
      handler: async ({ id }) => ({ id, name: "Ada" }),
    });
    const result = await Effect.runPromise(t.handler({ id: "u1" }));
    expect(result).toEqual({ id: "u1", name: "Ada" });
  });

  it("fails with ToolOutputValidationError when the return value doesn't match", async () => {
    const t = defineTool({
      name: "get-user-broken",
      description: "Fetch a user (buggy handler)",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ id: Schema.String, name: Schema.String }),
      // Bug: forgot to include `name`.
      handler: async ({ id }) => ({ id }),
    });
    const result = await Effect.runPromiseExit(t.handler({ id: "u1" }));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      const msg = JSON.stringify(result.cause);
      expect(msg).toContain("ToolOutputValidationError");
      expect(msg).toContain("get-user-broken");
    }
  });

  it("skips validation entirely when no output schema is given (unchanged behavior)", async () => {
    const t = defineTool({
      name: "no-output-schema",
      description: "No output schema declared",
      input: Schema.Struct({ id: Schema.String }),
      handler: async ({ id }) => ({ anything: id, extra: true }),
    });
    const result = await Effect.runPromise(t.handler({ id: "u1" }));
    expect(result).toEqual({ anything: "u1", extra: true });
  });
});
