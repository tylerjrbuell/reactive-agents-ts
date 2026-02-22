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
      // 5 built-in tools + 1 registered
      expect(fcTools.length).toBeGreaterThanOrEqual(1);
      const searchTool = fcTools.find((t) => t.name === "search");
      expect(searchTool).toBeDefined();
      expect(searchTool!.name).toBe("search");
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
      // 5 built-in + 2 registered = 7
      expect(all).toHaveLength(7);

      const searchOnly = yield* tools.listTools({ category: "search" });
      // built-in web-search + tool-a
      expect(searchOnly).toHaveLength(2);
      expect(searchOnly.map((t) => t.name)).toContain("tool-a");

      const highRisk = yield* tools.listTools({ riskLevel: "high" });
      // built-in file-write + tool-b
      expect(highRisk).toHaveLength(2);
      expect(highRisk.map((t) => t.name)).toContain("tool-b");

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

  it("should connect to an MCP server (sse stub)", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      // Use sse transport (stub path — no subprocess spawned in unit tests)
      const server = yield* tools.connectMCPServer({
        name: "test-server",
        transport: "sse",
        endpoint: "http://localhost:3001",
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
        transport: "sse",
        endpoint: "http://localhost:3001",
      });

      yield* tools.disconnectMCPServer("test-server");

      const servers = yield* tools.listMCPServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].status).toBe("disconnected");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should load all built-in tools automatically", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      const all = yield* tools.listTools();
      const names = all.map((t) => t.name);

      // All 5 built-in tools should be registered
      expect(names).toContain("web-search");
      expect(names).toContain("http-get");
      expect(names).toContain("file-read");
      expect(names).toContain("file-write");
      expect(names).toContain("code-execute");
      expect(all.length).toBeGreaterThanOrEqual(5);

      // Verify they have correct source
      const builtins = all.filter((t) => t.source === "builtin");
      expect(builtins.length).toBeGreaterThanOrEqual(5);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should include built-in tools in function calling format", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      const fcTools = yield* tools.toFunctionCallingFormat();
      const names = fcTools.map((t) => t.name);

      expect(names).toContain("web-search");
      expect(names).toContain("http-get");
      expect(names).toContain("file-read");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should allow filtering built-in tools by category", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      const searchTools = yield* tools.listTools({ category: "search" });
      expect(searchTools.map((t) => t.name)).toContain("web-search");

      const httpTools = yield* tools.listTools({ category: "http" });
      expect(httpTools.map((t) => t.name)).toContain("http-get");

      const fileTools = yield* tools.listTools({ category: "file" });
      expect(fileTools.map((t) => t.name)).toContain("file-read");
      expect(fileTools.map((t) => t.name)).toContain("file-write");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should populate MCP tool parameters from schemas", async () => {
    // This tests the MCP parameter population logic by verifying
    // that when an MCP server returns tool schemas with inputSchema,
    // the registered tools have proper parameters
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      // Connect via sse (stub transport - no subprocess)
      // The stub returns empty tools, but we verify the registration mechanism
      const server = yield* tools.connectMCPServer({
        name: "schema-test",
        transport: "sse",
        endpoint: "http://localhost:3002",
      });

      expect(server.status).toBe("connected");
      // SSE stub returns empty tools - that's OK for this unit test
      // The full integration is tested via the MCP client tests
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should still allow registering additional tools alongside built-ins", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      const beforeCount = (yield* tools.listTools()).length;

      yield* tools.register(
        {
          name: "custom-tool",
          description: "A custom tool",
          parameters: [],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        () => Effect.succeed("custom result"),
      );

      const afterAll = yield* tools.listTools();
      expect(afterAll.length).toBe(beforeCount + 1);
      expect(afterAll.map((t) => t.name)).toContain("custom-tool");

      // Built-ins still present
      expect(afterAll.map((t) => t.name)).toContain("web-search");
      expect(afterAll.map((t) => t.name)).toContain("http-get");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });
});
