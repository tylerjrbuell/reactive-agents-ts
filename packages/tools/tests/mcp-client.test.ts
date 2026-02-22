import { Effect } from "effect";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { makeMCPClient } from "../src/mcp/mcp-client.js";

const createMockMcpServer = (port: number) => {
  return Bun.serve({
    port,
    idleTimeout: 10,
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
              setTimeout(() => {
                try {
                  controller.close();
                } catch {
                  // Already closed
                }
              }, 50);
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
                serverInfo: { name: "test-server", version: "1.0.0" },
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

describe("MCPClient", () => {
  let server: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    server = createMockMcpServer(0);
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    server.stop();
  });

  it("should connect to a server via SSE", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const serverConn = yield* client.connect({
        name: "test-server",
        transport: "sse",
        endpoint: `http://localhost:${server.port}/sse`,
      });

      expect(serverConn.name).toBe("test-server");
      expect(serverConn.status).toBe("connected");
      expect(serverConn.transport).toBe("sse");
      expect(serverConn.version).toBe("1.0.0");
    });

    await Effect.runPromise(program);
  });

  it("should list connected servers", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "server-a",
        transport: "sse",
        endpoint: `http://localhost:${server.port}/sse`,
      });

      yield* client.disconnect("server-a");

      const servers = yield* client.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].status).toBe("disconnected");
    });

    await Effect.runPromise(program);
  });

  it("should disconnect a server", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "test-server",
        transport: "sse",
        endpoint: `http://localhost:${server.port}/sse`,
      });

      yield* client.disconnect("test-server");

      const servers = yield* client.listServers();
      expect(servers[0].status).toBe("disconnected");
    });

    await Effect.runPromise(program);
  });

  it("should fail callTool on disconnected server", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const error = yield* client
        .callTool("nonexistent", "some-tool", {})
        .pipe(Effect.flip);

      expect(error._tag).toBe("MCPConnectionError");
    });

    await Effect.runPromise(program);
  });
});
