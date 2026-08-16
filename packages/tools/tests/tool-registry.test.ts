import { Cause, Effect, Exit } from "effect";
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

  it("should self-heal a near-miss tool name (≤2 edits) instead of failing", async () => {
    // Regression proof for the 2026-08-15 real-world benchmark finding:
    // cogito:14b called "file/write" for the registered "file-write" (1 edit)
    // on every retry and never self-corrected because the shared registry
    // hard-failed with no healing. get() must now resolve the near miss.
    const program = Effect.gen(function* () {
      const registry = yield* makeToolRegistry;
      yield* registry.register(
        {
          name: "file-write",
          description: "Write a file",
          parameters: [],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        () => Effect.succeed("written"),
      );

      const tool = yield* registry.get("file/write");
      expect(tool.definition.name).toBe("file-write");
      const result = yield* tool.handler({});
      expect(result).toBe("written");
    });

    await Effect.runPromise(program);
  });

  it("does not heal a name too far from any registered tool", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makeToolRegistry;
      yield* registry.register(
        {
          name: "file-write",
          description: "Write a file",
          parameters: [],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        () => Effect.succeed("written"),
      );

      const error = yield* registry.get("completely-different-tool").pipe(Effect.flip);
      expect(error._tag).toBe("ToolNotFoundError");
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

// #57: register() runs the incoming definition through ToolDefinitionSchema
// so a malformed definition (raw object literal, `as any` cast, or one
// assembled dynamically from an MCP server) fails loudly and specifically at
// registration, naming the tool and the field — not silently, to surface as
// a generic failure later, deep in execution.
describe("ToolRegistry — definition validation (#57)", () => {
  it("registers a well-formed definition without incident", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makeToolRegistry;
      yield* registry.register(
        {
          name: "well-formed",
          description: "A valid tool",
          parameters: [],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        () => Effect.succeed("ok"),
      );
      const tool = yield* registry.get("well-formed");
      expect(tool.definition.name).toBe("well-formed");
    });

    await Effect.runPromise(program);
  });

  it("dies with a ToolDefinitionError naming the tool when 'description' is missing", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makeToolRegistry;
      // Simulates a raw object literal / dynamically-assembled definition
      // that bypasses TypeScript's compile-time check.
      yield* registry.register(
        {
          name: "malformed",
          parameters: [],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        } as never,
        () => Effect.succeed("unreachable"),
      );
    });

    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defect = Cause.squash(exit.cause) as { _tag?: string; toolName?: string; field?: string };
      expect(defect._tag).toBe("ToolDefinitionError");
      expect(defect.toolName).toBe("malformed");
      expect(defect.field).toBe("definition");
    }
  });

  it("dies with a ToolDefinitionError naming the tool when a parameter entry has no 'name'", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* makeToolRegistry;
      yield* registry.register(
        {
          name: "bad-params",
          description: "Missing parameter name",
          parameters: [{ type: "string", required: true } as never],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        () => Effect.succeed("unreachable"),
      );
    });

    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defect = Cause.squash(exit.cause) as { _tag?: string; toolName?: string };
      expect(defect._tag).toBe("ToolDefinitionError");
      expect(defect.toolName).toBe("bad-params");
    }
  });
});
