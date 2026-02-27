import { Effect } from "effect";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { makeMCPClient } from "../src/mcp/mcp-client.js";

// ─── Mock server helpers ───────────────────────────────────────────────────

const SESSION_ID = "test-session-abc123";

interface MockServer {
  port: number;
  stop: () => void;
}

/**
 * A minimal Streamable HTTP MCP server (2025-03-26 spec):
 * - POST /mcp  → JSON-RPC dispatch; returns Mcp-Session-Id on initialize
 * - POST /mcp  → 202 for notifications
 * - POST /mcp  → text/event-stream for tools/call when tool name is "streaming-echo"
 * - DELETE /mcp → 200 to acknowledge session termination
 */
const createMockStreamableHttpServer = (): MockServer => {
  const server = Bun.serve({
    port: 0,
    idleTimeout: 5,
    async fetch(req) {
      if (req.method === "DELETE") {
        return new Response(null, { status: 200 });
      }

      if (req.method === "POST") {
        const body = (await req.json()) as {
          jsonrpc: string;
          id?: number | string;
          method: string;
          params?: Record<string, unknown>;
        };

        if (body.method === "initialize") {
          return Response.json(
            {
              jsonrpc: "2.0",
              id: body.id,
              result: {
                protocolVersion: "2025-03-26",
                capabilities: { tools: {} },
                serverInfo: { name: "mock-streamable", version: "1.0.0" },
              },
            },
            { headers: { "Mcp-Session-Id": SESSION_ID } },
          );
        }

        if (body.method === "notifications/initialized") {
          return new Response(null, { status: 202 });
        }

        if (body.method === "tools/list") {
          // The mock returns 400 if the session ID is missing — proves propagation
          if (!req.headers.get("Mcp-Session-Id")) {
            return new Response("Missing Mcp-Session-Id", { status: 400 });
          }
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "echo",
                  description: "Echoes input",
                  inputSchema: {
                    type: "object",
                    properties: { text: { type: "string" } },
                  },
                },
                {
                  name: "streaming-echo",
                  description: "Echo with SSE streaming response",
                  inputSchema: {
                    type: "object",
                    properties: { text: { type: "string" } },
                  },
                },
              ],
            },
          });
        }

        if (body.method === "tools/call") {
          const toolName = (body.params as { name: string })?.name;

          // Return an SSE stream for the streaming-echo tool
          if (toolName === "streaming-echo") {
            const responseData = JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: { content: [{ type: "text", text: "streamed result" }] },
            });
            return new Response(
              new ReadableStream({
                start(controller) {
                  const enc = new TextEncoder();
                  controller.enqueue(
                    enc.encode(`event: message\ndata: ${responseData}\n\n`),
                  );
                  setTimeout(() => {
                    try {
                      controller.close();
                    } catch {
                      /* already closed */
                    }
                  }, 50);
                },
              }),
              { headers: { "Content-Type": "text/event-stream" } },
            );
          }

          // Default: plain JSON response
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: { content: [{ type: "text", text: "json result" }] },
          });
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });
  return server;
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("MCP Streamable HTTP Transport", () => {
  let mockServer: MockServer;

  beforeEach(() => {
    mockServer = createMockStreamableHttpServer();
  });

  afterEach(() => {
    mockServer.stop();
  });

  it("should connect and discover tools", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const server = yield* client.connect({
        name: "test-sh-server",
        transport: "streamable-http",
        endpoint: `http://localhost:${mockServer.port}/mcp`,
      });

      expect(server.name).toBe("test-sh-server");
      expect(server.status).toBe("connected");
      expect(server.transport).toBe("streamable-http");
      expect(server.tools).toContain("echo");
      expect(server.version).toBe("1.0.0");
    });

    await Effect.runPromise(program);
  });

  it("should propagate Mcp-Session-Id on subsequent requests", async () => {
    // The mock returns 400 for tools/list without Mcp-Session-Id.
    // A successful connect() proves the session ID was forwarded correctly.
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const server = yield* client.connect({
        name: "session-test",
        transport: "streamable-http",
        endpoint: `http://localhost:${mockServer.port}/mcp`,
      });

      expect(server.status).toBe("connected");
    });

    await Effect.runPromise(program);
  });

  it("should call a tool and receive a plain JSON response", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "json-response-test",
        transport: "streamable-http",
        endpoint: `http://localhost:${mockServer.port}/mcp`,
      });

      const result = yield* client.callTool("json-response-test", "echo", {
        text: "hello",
      });

      expect(result).toBe("json result");
    });

    await Effect.runPromise(program);
  });

  it("should call a tool and receive an SSE streaming response", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "sse-response-test",
        transport: "streamable-http",
        endpoint: `http://localhost:${mockServer.port}/mcp`,
      });

      const result = yield* client.callTool(
        "sse-response-test",
        "streaming-echo",
        { text: "stream" },
      );

      expect(result).toBe("streamed result");
    });

    await Effect.runPromise(program);
  });

  it("should disconnect by sending HTTP DELETE", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "delete-test",
        transport: "streamable-http",
        endpoint: `http://localhost:${mockServer.port}/mcp`,
      });

      yield* client.disconnect("delete-test");

      const servers = yield* client.listServers();
      const server = servers.find((s) => s.name === "delete-test");
      expect(server?.status).toBe("disconnected");
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

  it("should include user-supplied auth headers on all requests", async () => {
    const authServer = Bun.serve({
      port: 0,
      idleTimeout: 5,
      async fetch(req) {
        if (req.method === "DELETE") return new Response(null, { status: 200 });
        if (req.method === "POST") {
          if (req.headers.get("Authorization") !== "Bearer test-token") {
            return new Response("Unauthorized", { status: 401 });
          }
          const body = (await req.json()) as { id: number; method: string };
          if (body.method === "initialize") {
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                protocolVersion: "2025-03-26",
                capabilities: { tools: {} },
                serverInfo: { name: "auth-server", version: "1.0.0" },
              },
            });
          }
          if (body.method === "notifications/initialized")
            return new Response(null, { status: 202 });
          if (body.method === "tools/list")
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: { tools: [] },
            });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      const program = Effect.gen(function* () {
        const client = yield* makeMCPClient;

        const server = yield* client.connect({
          name: "auth-test",
          transport: "streamable-http",
          endpoint: `http://localhost:${authServer.port}/mcp`,
          headers: { Authorization: "Bearer test-token" },
        });

        expect(server.status).toBe("connected");
      });

      await Effect.runPromise(program);
    } finally {
      authServer.stop();
    }
  });
});
