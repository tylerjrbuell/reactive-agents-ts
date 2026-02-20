import { Effect } from "effect";
import { describe, it, expect } from "bun:test";

import { makeMCPClient } from "../src/mcp/mcp-client.js";

describe("MCPClient", () => {
  it("should connect to a server (stub)", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const server = yield* client.connect({
        name: "test-server",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
      });

      expect(server.name).toBe("test-server");
      expect(server.status).toBe("connected");
      expect(server.transport).toBe("stdio");
    });

    await Effect.runPromise(program);
  });

  it("should list connected servers", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "server-a",
        transport: "stdio",
        command: "node",
        args: [],
      });

      yield* client.connect({
        name: "server-b",
        transport: "sse",
        endpoint: "http://localhost:3000",
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
        transport: "stdio",
        command: "node",
        args: [],
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
