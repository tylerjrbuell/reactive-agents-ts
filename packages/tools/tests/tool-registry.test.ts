import { Effect } from "effect";
import { describe, it, expect } from "bun:test";

import { makeToolRegistry } from "../src/registry/tool-registry.js";

describe("ToolRegistry", () => {
  it("should register and retrieve a tool", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makeToolRegistry;

      yield* registry.register(
        {
          name: "echo",
          description: "Echo input",
          parameters: [
            {
              name: "text",
              type: "string",
              description: "Text to echo",
              required: true,
            },
          ],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        (args) => Effect.succeed(args.text),
      );

      const tool = yield* registry.get("echo");
      expect(tool.definition.name).toBe("echo");

      const result = yield* tool.handler({ text: "hello" });
      expect(result).toBe("hello");
    });

    await Effect.runPromise(program);
  });

  it("should fail when getting a non-existent tool", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makeToolRegistry;

      const error = yield* registry.get("missing").pipe(Effect.flip);
      expect(error._tag).toBe("ToolNotFoundError");
      expect(error.toolName).toBe("missing");
    });

    await Effect.runPromise(program);
  });

  it("should list all tools", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makeToolRegistry;

      yield* registry.register(
        {
          name: "tool-1",
          description: "Tool 1",
          parameters: [],
          category: "search",
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "builtin",
        },
        () => Effect.succeed(null),
      );

      yield* registry.register(
        {
          name: "tool-2",
          description: "Tool 2",
          parameters: [],
          category: "file",
          riskLevel: "high",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        () => Effect.succeed(null),
      );

      const all = yield* registry.list();
      expect(all).toHaveLength(2);

      const searchOnly = yield* registry.list({ category: "search" });
      expect(searchOnly).toHaveLength(1);
      expect(searchOnly[0].name).toBe("tool-1");
    });

    await Effect.runPromise(program);
  });

  it("should convert tools to function calling format", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makeToolRegistry;

      yield* registry.register(
        {
          name: "search",
          description: "Search things",
          parameters: [
            {
              name: "query",
              type: "string",
              description: "Query",
              required: true,
            },
            {
              name: "limit",
              type: "number",
              description: "Result limit",
              required: false,
            },
          ],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "builtin",
        },
        () => Effect.succeed([]),
      );

      const fcTools = yield* registry.toFunctionCallingFormat();
      expect(fcTools).toHaveLength(1);
      expect(fcTools[0].name).toBe("search");
      expect(fcTools[0].description).toBe("Search things");

      const schema = fcTools[0].input_schema as Record<string, unknown>;
      expect(schema).toHaveProperty("type", "object");
      expect(schema).toHaveProperty("properties");
      expect(schema).toHaveProperty("required");

      const required = schema.required as string[];
      expect(required).toContain("query");
      expect(required).not.toContain("limit");
    });

    await Effect.runPromise(program);
  });

  it("should overwrite tool on re-register", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makeToolRegistry;

      yield* registry.register(
        {
          name: "dupe",
          description: "Version 1",
          parameters: [],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        () => Effect.succeed("v1"),
      );

      yield* registry.register(
        {
          name: "dupe",
          description: "Version 2",
          parameters: [],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        () => Effect.succeed("v2"),
      );

      const tool = yield* registry.get("dupe");
      expect(tool.definition.description).toBe("Version 2");
      const result = yield* tool.handler({});
      expect(result).toBe("v2");
    });

    await Effect.runPromise(program);
  });
});
