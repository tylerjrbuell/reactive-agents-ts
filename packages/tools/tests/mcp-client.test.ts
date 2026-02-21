import { Effect } from "effect";
import { describe, it, expect } from "bun:test";

import { makeMCPClient } from "../src/mcp/mcp-client.js";

// NOTE: These tests use transport:"sse" which is a stub (no subprocess spawned).
// Real stdio transport is tested separately in mcp-stdio-integration.test.ts
// once a test MCP server binary is available.

describe("MCPClient", () => {
  it("should connect to a server (sse stub)", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const server = yield* client.connect({
        name: "test-server",
        transport: "sse",
        endpoint: "http://localhost:3001",
      });

      expect(server.name).toBe("test-server");
      expect(server.status).toBe("connected");
      expect(server.transport).toBe("sse");
    });

    await Effect.runPromise(program);
  });

  it("should list connected servers", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "server-a",
        transport: "sse",
        endpoint: "http://localhost:3001",
      });

      yield* client.connect({
        name: "server-b",
        transport: "sse",
        endpoint: "http://localhost:3002",
      });

      const servers = yield* client.listServers();
      expect(servers).toHaveLength(2);
    });

    await Effect.runPromise(program);
  });

  it("should disconnect a server", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "test-server",
        transport: "sse",
        endpoint: "http://localhost:3001",
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
