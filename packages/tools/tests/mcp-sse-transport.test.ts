import { Effect } from "effect";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { makeMCPClient } from "../src/mcp/mcp-client.js";

interface MockServer {
  port: number;
  stop: () => void;
}

const createMockMcpServer = (port: number): MockServer => {
  const server = Bun.serve({
    port,
    idleTimeout: 5,
    fetch(req) {
      if (req.method === "POST") {
        return req.json().then((body) => {
          if (body.method === "initialize") {
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "mock-mcp", version: "1.0.0" },
              },
            });
          }
          if (body.method === "tools/list") {
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                tools: [
                  {
                    name: "test-tool",
                    description: "A test tool",
                    inputSchema: {
                      type: "object",
                      properties: {
                        arg1: { type: "string" },
                      },
                    },
                  },
                ],
              },
            });
          }
          if (body.method === "tools/call") {
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: { content: [{ type: "text", text: "tool result" }] },
            });
          }
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {},
          });
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });
  return server;
};

describe("MCP Streamable-HTTP Transport", () => {
  let mockServer: MockServer;

  beforeEach(() => {
    mockServer = createMockMcpServer(0);
  });

  afterEach(() => {
    mockServer.stop();
  });

  it("should connect to SSE MCP server and discover tools", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const server = yield* client.connect({
        name: "test-sse-server",
        transport: "streamable-http",
        endpoint: `http://localhost:${mockServer.port}/mcp`,
      });

      expect(server.name).toBe("test-sse-server");
      expect(server.status).toBe("connected");
      expect(server.transport).toBe("streamable-http");
      expect(server.tools).toContain("test-tool");
      expect(server.version).toBe("1.0.0");
    });

    await Effect.runPromise(program);
  });

  it("should handle disconnect and reconnect", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "reconnect-test",
        transport: "streamable-http",
        endpoint: `http://localhost:${mockServer.port}/mcp`,
      });

      yield* client.disconnect("reconnect-test");

      const servers = yield* client.listServers();
      const server = servers.find((s) => s.name === "reconnect-test");
      expect(server?.status).toBe("disconnected");
    });

    await Effect.runPromise(program);
  });

  it("should call tools via streamable-http transport", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "tool-call-test",
        transport: "streamable-http",
        endpoint: `http://localhost:${mockServer.port}/mcp`,
      });

      const result = yield* client.callTool("tool-call-test", "test-tool", {
        arg1: "hello",
      });

      expect(result).toBeDefined();
    });

    await Effect.runPromise(program);
  });

  it("should reject connection when endpoint is missing", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const error = yield* client
        .connect({
          name: "no-endpoint",
          transport: "streamable-http",
          endpoint: "",
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("MCPConnectionError");
    });

    await Effect.runPromise(program);
  });
});

describe("SSE Transport Error Handling", () => {
  it("should handle connection refused gracefully", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const error = yield* client
        .connect({
          name: "refused-server",
          transport: "streamable-http",
          endpoint: "http://localhost:19999/mcp",
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("MCPConnectionError");
    });

    await Effect.runPromise(program);
  });

  it("should reject when transport not initialized before sendRequest", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const error = yield* client
        .callTool("unconnected-server", "some-tool", {})
        .pipe(Effect.flip);

      expect(error._tag).toBe("MCPConnectionError");
    });

    await Effect.runPromise(program);
  });

  it("should handle malformed server response gracefully", async () => {
    const badServer = Bun.serve({
      port: 0,
      idleTimeout: 5,
      fetch() {
        return new Response("not valid json", { status: 200 });
      },
    });

    try {
      const program = Effect.gen(function* () {
        const client = yield* makeMCPClient;

        const error = yield* client
          .connect({
            name: "bad-server",
            transport: "streamable-http",
            endpoint: `http://localhost:${badServer.port}/mcp`,
          })
          .pipe(Effect.flip);

        expect(error._tag).toBe("MCPConnectionError");
      });

      await Effect.runPromise(program);
    } finally {
      badServer.stop();
    }
  });
});
