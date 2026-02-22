import { Effect, Layer } from "effect";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { EventBusLive } from "@reactive-agents/core";
import { ToolService, ToolServiceLive } from "../src/tool-service.js";

const TestToolLayer = ToolServiceLive.pipe(Layer.provide(EventBusLive));

const createMockMcpServer = (port: number) => {
  return Bun.serve({
    port,
    idleTimeout: 5,
    fetch(req) {
      if (req.method === "GET") {
        return new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              const initialData = JSON.stringify({
                jsonrpc: "2.0",
                id: null,
                result: { tools: [] },
              });
              controller.enqueue(
                encoder.encode(`event: message\ndata: ${initialData}\n\n`),
              );
              setTimeout(() => controller.close(), 100);
            },
          }),
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            },
          },
        );
      }

      if (req.method === "POST") {
        return req.json().then((body) => {
          if (body.method === "initialize") {
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "test-mcp", version: "1.0.0" },
              },
            });
          }
          if (body.method === "tools/list") {
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: { tools: [{ name: "test-tool", description: "Test", inputSchema: {} }] },
            });
          }
          return Response.json({ jsonrpc: "2.0", id: body.id, result: {} });
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });
};

describe("ToolService", () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    mockServer = createMockMcpServer(0);
  });

  afterEach(() => {
    mockServer.stop();
  });

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

  it("should connect to an MCP server via SSE", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      const server = yield* tools.connectMCPServer({
        name: "test-server",
        transport: "sse",
        endpoint: `http://localhost:${mockServer.port}/sse`,
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
        endpoint: `http://localhost:${mockServer.port}/sse`,
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
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      const server = yield* tools.connectMCPServer({
        name: "schema-test",
        transport: "sse",
        endpoint: `http://localhost:${mockServer.port}/sse`,
      });

      expect(server.status).toBe("connected");
      expect(server.tools).toContain("test-tool");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should end-to-end: register → validate → sandbox execute → result", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      // Register a tool with strict params
      yield* tools.register(
        {
          name: "greet-formal",
          description: "Formally greet a person",
          parameters: [
            {
              name: "firstName",
              type: "string",
              description: "First name",
              required: true,
            },
            {
              name: "title",
              type: "string",
              description: "Title (Mr., Ms., Dr.)",
              required: true,
              enum: ["Mr.", "Ms.", "Dr."],
            },
          ],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        (args) =>
          Effect.succeed(
            `Good day, ${args.title} ${args.firstName}!`,
          ),
      );

      // Valid execution
      const result = yield* tools.execute({
        toolName: "greet-formal",
        arguments: { firstName: "Ada", title: "Dr." },
        agentId: "agent-e2e",
        sessionId: "session-e2e",
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe("Good day, Dr. Ada!");
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

      // Invalid enum value should fail validation
      const badResult = yield* tools
        .execute({
          toolName: "greet-formal",
          arguments: { firstName: "Ada", title: "Prof." },
          agentId: "agent-e2e",
          sessionId: "session-e2e",
        })
        .pipe(Effect.flip);

      expect(badResult._tag).toBe("ToolValidationError");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("should document requiresApproval flag (currently not enforced at service level)", async () => {
    // requiresApproval is a metadata flag — it's up to the execution engine
    // or interaction layer to check it. ToolService executes regardless.
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      yield* tools.register(
        {
          name: "dangerous-tool",
          description: "A tool requiring approval",
          parameters: [],
          riskLevel: "critical",
          timeoutMs: 5000,
          requiresApproval: true,
          source: "function",
        },
        () => Effect.succeed("executed anyway"),
      );

      // Tool still executes — approval is enforced by higher layers
      const result = yield* tools.execute({
        toolName: "dangerous-tool",
        arguments: {},
        agentId: "agent-1",
        sessionId: "session-1",
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe("executed anyway");

      // Verify the definition has requiresApproval set
      const def = yield* tools.getTool("dangerous-tool");
      expect(def.requiresApproval).toBe(true);
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
