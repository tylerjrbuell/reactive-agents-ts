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
      const url = new URL(req.url);

      if (req.method === "GET" && (url.pathname.endsWith("/sse") || url.pathname === "/")) {
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
              setTimeout(() => {
                controller.close();
              }, 100);
            },
          }),
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
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

describe("MCP SSE Transport", () => {
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
        transport: "sse",
        endpoint: `http://localhost:${mockServer.port}/sse`,
      });

      expect(server.name).toBe("test-sse-server");
      expect(server.status).toBe("connected");
      expect(server.transport).toBe("sse");
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
        transport: "sse",
        endpoint: `http://localhost:${mockServer.port}/sse`,
      });

      yield* client.disconnect("reconnect-test");

      const servers = yield* client.listServers();
      const server = servers.find((s) => s.name === "reconnect-test");
      expect(server?.status).toBe("disconnected");
    });

    await Effect.runPromise(program);
  });

  it("should call tools via SSE transport", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "tool-call-test",
        transport: "sse",
        endpoint: `http://localhost:${mockServer.port}/sse`,
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
          transport: "sse",
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
          transport: "sse",
          endpoint: "http://localhost:19999/sse",
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

  it("should handle malformed SSE events gracefully", async () => {
    const badServer = Bun.serve({
      port: 0,
      idleTimeout: 5,
      fetch(req) {
        if (req.method === "GET") {
          return new Response(
            new ReadableStream({
              start(controller) {
                const encoder = new TextEncoder();
                controller.enqueue(
                  encoder.encode("not valid sse\nevent: message\ndata: invalid json\n\n"),
                );
                setTimeout(() => controller.close(), 100);
              },
            }),
            {
              headers: {
                "Content-Type": "text/event-stream",
              },
            },
          );
        }

        return req.json().then((body) =>
          Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "mock-mcp", version: "1.0.0" },
            },
          }),
        );
      },
    });

    try {
      const program = Effect.gen(function* () {
        const client = yield* makeMCPClient;

        const server = yield* client.connect({
          name: "bad-sse-server",
          transport: "sse",
          endpoint: `http://localhost:${badServer.port}/sse`,
        });

        expect(server.name).toBe("bad-sse-server");
        expect(server.status).toBe("connected");
      });

      await Effect.runPromise(program);
    } finally {
      badServer.stop();
    }
  });
});
