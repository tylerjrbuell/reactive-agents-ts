import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { tool } from "../src/define-tool-simple.js";

describe("tool() simple wrapper", () => {
  it("should create a tool from name + description + handler", () => {
    const t = tool("greet", "Greet someone", async (args) => `Hi ${args.name}`);
    expect(t.definition.name).toBe("greet");
    expect(t.definition.description).toBe("Greet someone");
    expect(t.definition.parameters).toEqual([]);
  });

  it("should accept explicit params", () => {
    const t = tool("search", "Search", {
      params: {
        query: { type: "string", required: true, description: "Query" },
        limit: { type: "number", required: false, description: "Limit", default: 5 },
      },
      handler: async (args) => args.query,
    });
    expect(t.definition.parameters).toHaveLength(2);
    expect(t.definition.parameters[0]!.name).toBe("query");
    expect(t.definition.parameters[0]!.required).toBe(true);
    expect(t.definition.parameters[1]!.name).toBe("limit");
    expect(t.definition.parameters[1]!.required).toBe(false);
  });

  it("should wrap async handler into Effect", async () => {
    const t = tool("echo", "Echo input", async (args) => args.text);
    const result = await Effect.runPromise(t.handler({ text: "hello" }));
    expect(result).toBe("hello");
  });

  it("should catch handler errors as ToolExecutionError", async () => {
    const t = tool("fail", "Always fails", async () => {
      throw new Error("boom");
    });
    const result = await Effect.runPromise(t.handler({}).pipe(Effect.either));
    expect(result._tag).toBe("Left");
  });

  it("should accept options like riskLevel, timeout, category", () => {
    const t = tool("risky", "Risky op", {
      handler: async () => "done",
      riskLevel: "high",
      timeoutMs: 60_000,
      category: "code",
    });
    expect(t.definition.riskLevel).toBe("high");
    expect(t.definition.timeoutMs).toBe(60_000);
    expect(t.definition.category).toBe("code");
  });

  it("should use default riskLevel 'low' and timeoutMs 30_000 when not specified", () => {
    const t = tool("simple", "Simple tool", async () => "ok");
    expect(t.definition.riskLevel).toBe("low");
    expect(t.definition.timeoutMs).toBe(30_000);
    expect(t.definition.requiresApproval).toBe(false);
    expect(t.definition.source).toBe("function");
  });

  it("should preserve default param values in definition", () => {
    const t = tool("with-defaults", "Tool with defaults", {
      params: {
        limit: { type: "number", required: false, description: "Limit", default: 10 },
        mode: { type: "string", required: false, description: "Mode", enum: ["fast", "slow"] },
      },
      handler: async (args) => args,
    });
    const limitParam = t.definition.parameters.find((p) => p.name === "limit");
    const modeParam = t.definition.parameters.find((p) => p.name === "mode");
    expect(limitParam?.default).toBe(10);
    expect(modeParam?.enum).toEqual(["fast", "slow"]);
  });

  it("should handle synchronous handlers", async () => {
    const t = tool("sync", "Sync tool", (args) => `sync: ${args.value}`);
    const result = await Effect.runPromise(t.handler({ value: "test" }));
    expect(result).toBe("sync: test");
  });
});
