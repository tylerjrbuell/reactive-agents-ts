import { Effect } from "effect";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { makeMCPClient } from "../src/mcp/mcp-client.js";

interface MockWsServer {
  port: number;
  stop: () => void;
  ws: any;
}

const createMockMcpWsServer = (port: number): MockWsServer => {
  let ws: any = null;
  
  const server = Bun.serve({
    port,
    idleTimeout: 5,
    fetch(req, srv) {
      if (req.headers.get("upgrade") === "websocket") {
        const success = srv.upgrade(req);
        if (success) {
          return undefined;
        }
        return new Response("WebSocket upgrade failed", { status: 500 });
      }
      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws_) {
        ws = ws_;
      },
      message(ws_, message) {
        try {
          const msgText = message.toString();
          const parsedMessage = JSON.parse(msgText);
          let response: Record<string, unknown>;

          if (parsedMessage.method === "initialize") {
            response = {
              jsonrpc: "2.0",
              id: parsedMessage.id,
              result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "mock-ws-mcp", version: "1.0.0" },
              },
            };
          } else if (parsedMessage.method === "tools/list") {
            response = {
              jsonrpc: "2.0",
              id: parsedMessage.id,
              result: {
                tools: [
                  {
                    name: "ws-test-tool",
                    description: "A WebSocket test tool",
                    inputSchema: {
                      type: "object",
                      properties: {
                        arg1: { type: "string" },
                      },
                    },
                  },
                ],
              },
            };
          } else if (parsedMessage.method === "tools/call") {
            response = {
              jsonrpc: "2.0",
              id: parsedMessage.id,
              result: { content: [{ type: "text", text: "ws tool result" }] },
            };
          } else {
            response = {
              jsonrpc: "2.0",
              id: parsedMessage.id,
              result: {},
            };
          }

          ws_.send(JSON.stringify(response));
        } catch {
          // Ignore parse errors
        }
      },
    },
  });
  
  return {
    port: server.port,
    stop: () => server.stop(),
    get ws() { return ws; }
  };
};

describe("MCP WebSocket Transport", () => {
  let mockServer: MockWsServer;

  beforeEach(() => {
    mockServer = createMockMcpWsServer(0);
  });

  afterEach(() => {
    mockServer.stop();
  });

  it("should connect to WebSocket MCP server and discover tools", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const server = yield* client.connect({
        name: "test-ws-server",
        transport: "websocket",
        endpoint: `ws://localhost:${mockServer.port}`,
      });

      expect(server.name).toBe("test-ws-server");
      expect(server.status).toBe("connected");
      expect(server.transport).toBe("websocket");
      expect(server.tools).toContain("ws-test-tool");
      expect(server.version).toBe("1.0.0");
    });

    await Effect.runPromise(program);
  });

  it("should handle disconnect and cleanup", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "disconnect-test",
        transport: "websocket",
        endpoint: `ws://localhost:${mockServer.port}`,
      });

      yield* client.disconnect("disconnect-test");

      const servers = yield* client.listServers();
      const server = servers.find((s) => s.name === "disconnect-test");
      expect(server?.status).toBe("disconnected");
    });

    await Effect.runPromise(program);
  });

  it("should call tools via WebSocket transport", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "tool-call-test",
        transport: "websocket",
        endpoint: `ws://localhost:${mockServer.port}`,
      });

      const result = yield* client.callTool("tool-call-test", "ws-test-tool", {
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
          transport: "websocket",
          endpoint: "",
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("MCPConnectionError");
    });

    await Effect.runPromise(program);
  });
});

describe("WebSocket Transport Error Handling", () => {
  it("should handle connection refused gracefully", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const error = yield* client
        .connect({
          name: "refused-server",
          transport: "websocket",
          endpoint: "ws://localhost:19999",
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
});

describe("WebSocket Transport Reconnection", () => {
  it("should attempt reconnection on disconnect", async () => {
    const server = Bun.serve({
      port: 0,
      idleTimeout: 5,
      fetch(req, srv) {
        if (req.headers.get("upgrade") === "websocket") {
          const success = srv.upgrade(req);
          if (success) {
            return undefined;
          }
          return new Response("WebSocket upgrade failed", { status: 500 });
        }
        return new Response("Not Found", { status: 404 });
      },
      websocket: {
        message(ws, message) {
          try {
            const msgText = message.toString();
            const parsedMessage = JSON.parse(msgText);
            let response: Record<string, unknown>;

            if (parsedMessage.method === "initialize") {
              response = {
                jsonrpc: "2.0",
                id: parsedMessage.id,
                result: {
                  protocolVersion: "2024-11-05",
                  capabilities: { tools: {} },
                  serverInfo: { name: "reconnect-mcp", version: "1.0.0" },
                },
              };
            } else if (parsedMessage.method === "tools/list") {
              response = {
                jsonrpc: "2.0",
                id: parsedMessage.id,
                result: { tools: [{ name: "reconnect-tool", description: "test" }] },
              };
            } else {
              response = { jsonrpc: "2.0", id: parsedMessage.id, result: {} };
            }

            ws.send(JSON.stringify(response));
          } catch {
            // Ignore
          }
        },
      },
    });

    try {
      const program = Effect.gen(function* () {
        const client = yield* makeMCPClient;

        const serverInfo = yield* client.connect({
          name: "reconnect-test",
          transport: "websocket",
          endpoint: `ws://localhost:${server.port}`,
        });

        expect(serverInfo.tools).toContain("reconnect-tool");

        yield* client.disconnect("reconnect-test");
      });

      await Effect.runPromise(program);
    } finally {
      server.stop();
    }
  });
});
