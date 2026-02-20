import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";

import { EventBusLive } from "@reactive-agents/core";
import { ToolService, ToolServiceLive } from "../src/tool-service.js";

const TestToolLayer = ToolServiceLive.pipe(Layer.provide(EventBusLive));

describe("ToolService", () => {
  it("should register and execute a tool", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      yield* tools.register(
        {
          name: "add",
          description: "Add two numbers",
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
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        (args) => Effect.succeed((args.a as number) + (args.b as number)),
      );

      const result = yield* tools.execute({
        toolName: "add",
        arguments: { a: 2, b: 3 },
        agentId: "agent-1",
        sessionId: "session-1",
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe(5);
      expect(result.toolName).toBe("add");
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should fail for unknown tools", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      const result = yield* tools
        .execute({
          toolName: "nonexistent",
          arguments: {},
          agentId: "agent-1",
          sessionId: "session-1",
        })
        .pipe(Effect.flip);

      expect(result._tag).toBe("ToolNotFoundError");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should validate tool input parameters", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      yield* tools.register(
        {
          name: "greet",
          description: "Greet a person",
          parameters: [
            {
              name: "name",
              type: "string",
              description: "Person name",
              required: true,
            },
          ],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        (args) => Effect.succeed(`Hello, ${args.name}!`),
      );

      // Missing required parameter
      const result = yield* tools
        .execute({
          toolName: "greet",
          arguments: {},
          agentId: "agent-1",
          sessionId: "session-1",
        })
        .pipe(Effect.flip);

      expect(result._tag).toBe("ToolValidationError");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should list tools in function calling format", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      yield* tools.register(
        {
          name: "search",
          description: "Search for something",
          parameters: [
            {
              name: "query",
              type: "string",
              description: "Search query",
              required: true,
            },
          ],
          riskLevel: "low",
          timeoutMs: 10000,
          requiresApproval: false,
          source: "builtin",
        },
        (_args) => Effect.succeed([]),
      );

      const fcTools = yield* tools.toFunctionCallingFormat();
      expect(fcTools).toHaveLength(1);
      expect(fcTools[0].name).toBe("search");
      expect(fcTools[0].input_schema).toHaveProperty("properties");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should list tools with filtering", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      yield* tools.register(
        {
          name: "tool-a",
          description: "Tool A",
          parameters: [],
          category: "search",
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "builtin",
        },
        () => Effect.succeed("a"),
      );

      yield* tools.register(
        {
          name: "tool-b",
          description: "Tool B",
          parameters: [],
          category: "file",
          riskLevel: "high",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        () => Effect.succeed("b"),
      );

      const all = yield* tools.listTools();
      expect(all).toHaveLength(2);

      const searchOnly = yield* tools.listTools({ category: "search" });
      expect(searchOnly).toHaveLength(1);
      expect(searchOnly[0].name).toBe("tool-a");

      const highRisk = yield* tools.listTools({ riskLevel: "high" });
      expect(highRisk).toHaveLength(1);
      expect(highRisk[0].name).toBe("tool-b");

      const functions = yield* tools.listTools({ source: "function" });
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe("tool-b");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should get a specific tool definition", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      yield* tools.register(
        {
          name: "my-tool",
          description: "My tool",
          parameters: [],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        () => Effect.succeed("ok"),
      );

      const def = yield* tools.getTool("my-tool");
      expect(def.name).toBe("my-tool");
      expect(def.description).toBe("My tool");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should connect to an MCP server (stub)", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      const server = yield* tools.connectMCPServer({
        name: "test-server",
        transport: "stdio",
        command: "node",
        args: ["test-mcp-server.js"],
      });

      expect(server.status).toBe("connected");
      expect(server.name).toBe("test-server");

      const servers = yield* tools.listMCPServers();
      expect(servers).toHaveLength(1);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should disconnect from an MCP server", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      yield* tools.connectMCPServer({
        name: "test-server",
        transport: "stdio",
        command: "node",
        args: [],
      });

      yield* tools.disconnectMCPServer("test-server");

      const servers = yield* tools.listMCPServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].status).toBe("disconnected");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });
});
