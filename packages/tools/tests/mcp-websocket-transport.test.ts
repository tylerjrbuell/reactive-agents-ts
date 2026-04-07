/**
 * WebSocket transport is not provided by the official @modelcontextprotocol/sdk.
 * These tests verify that the client surfaces a clear MCPConnectionError when a
 * caller tries to use `transport: "websocket"`, and that unrelated error paths
 * (callTool on an unconnected server) still behave correctly.
 */
import { Effect } from "effect";
import { describe, it, expect } from "bun:test";

import { makeMCPClient } from "../src/mcp/mcp-client.js";

describe("MCP WebSocket Transport", () => {
  it("should return MCPConnectionError for websocket transport (not supported by SDK)", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const error = yield* client
        .connect({
          name: "test-ws-server",
          transport: "websocket",
          endpoint: "ws://localhost:9999",
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("MCPConnectionError");
    });

    await Effect.runPromise(program);
  });

  it("should reject connection when endpoint is missing for websocket", async () => {
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
