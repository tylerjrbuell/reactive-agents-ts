import { Effect } from "effect";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import {
  makeMCPClient,
  cleanupMcpTransport,
  addDockerPortMapping,
  buildDockerProbeArgs,
} from "../src/mcp/mcp-client.js";

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
              result: { tools: [{ name: "test-tool", description: "Test", inputSchema: { type: "object" } }] },
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
        transport: "streamable-http",
        endpoint: `http://localhost:${server.port}/mcp`,
      });

      expect(serverConn.name).toBe("test-server");
      expect(serverConn.status).toBe("connected");
      expect(serverConn.transport).toBe("streamable-http");
      expect(serverConn.version).toBe("1.0.0");
    });

    await Effect.runPromise(program);
  });

  it("should list connected servers", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      yield* client.connect({
        name: "server-a",
        transport: "streamable-http",
        endpoint: `http://localhost:${server.port}/mcp`,
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
        transport: "streamable-http",
        endpoint: `http://localhost:${server.port}/mcp`,
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

  it("should auto-infer streamable-http transport from /mcp endpoint", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      // transport omitted — should be inferred as streamable-http from /mcp path
      const srv = yield* client.connect({
        name: "inferred-transport",
        endpoint: `http://localhost:${server.port}/mcp`,
      });

      expect(srv.transport).toBe("streamable-http");
      expect(srv.status).toBe("connected");
    });

    await Effect.runPromise(program);
  });

  it("should surface MCPConnectionError for websocket transport", async () => {
    const program = Effect.gen(function* () {
      const client = yield* makeMCPClient;

      const error = yield* client
        .connect({ name: "ws-unsupported", transport: "websocket", endpoint: "ws://localhost:9999" })
        .pipe(Effect.flip);

      expect(error._tag).toBe("MCPConnectionError");
      expect(error.message).toContain("websocket");
    });

    await Effect.runPromise(program);
  });

  it("cleanupMcpTransport is a no-op for unknown server names", () => {
    // Should not throw
    expect(() => cleanupMcpTransport("never-connected")).not.toThrow();
  });
});

describe("docker arg shaping", () => {
  it("maps a distinct host port to the container's internal port", () => {
    // Reusing the container port as the host port collides with foreign
    // services on that host port; host and container ports must stay distinct.
    const out = addDockerPortMapping(
      ["run", "--rm", "-i", "mcp/context7"],
      54321, // free host port
      8080, // container's reported port
    );
    expect(out).toContain("-p");
    const pIdx = out.indexOf("-p");
    expect(out[pIdx + 1]).toBe("54321:8080");
    // mapping inserted before the image name
    expect(out.indexOf("-p")).toBeLessThan(out.indexOf("mcp/context7"));
  });

  it("inserts the port mapping before the image, after flags that consume a value", () => {
    const out = addDockerPortMapping(
      ["run", "--rm", "-e", "FOO=bar", "ghcr.io/example/server"],
      40000,
      3000,
    );
    expect(out).toEqual([
      "run", "--rm", "-e", "FOO=bar", "-p", "40000:3000", "ghcr.io/example/server",
    ]);
  });

  it("is a no-op when the command is not `docker run`", () => {
    const args = ["--port", "3000"];
    expect(addDockerPortMapping(args, 1, 2)).toEqual(args);
  });

  it("adds --rm and a deterministic --name to a docker probe", () => {
    const out = buildDockerProbeArgs(["run", "-i", "mcp/some-server"], "rax-probe-x-123");
    expect(out).toEqual(["run", "--name", "rax-probe-x-123", "--rm", "-i", "mcp/some-server"]);
  });

  it("does not duplicate --rm when already present", () => {
    const out = buildDockerProbeArgs(["run", "--rm", "-i", "img"], "rax-probe-y-9");
    expect(out.filter((a) => a === "--rm")).toHaveLength(1);
    expect(out).toContain("--name");
    expect(out[out.indexOf("--name") + 1]).toBe("rax-probe-y-9");
  });

  it("leaves non-`docker run` args untouched for probe shaping", () => {
    const args = ["serve", "--stdio"];
    expect(buildDockerProbeArgs(args, "n")).toEqual(args);
  });
});
