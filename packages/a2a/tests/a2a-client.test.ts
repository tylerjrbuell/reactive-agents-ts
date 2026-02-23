import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import { A2AClient, createA2AClient } from "../src/client/a2a-client.js";

let mockServer: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  if (mockServer) {
    mockServer.stop(true);
    mockServer = null;
  }
});

const startMockServer = (handler: (req: Request) => Response | Promise<Response>) => {
  mockServer = Bun.serve({
    port: 0, // random available port
    fetch: handler,
  });
  return mockServer;
};

describe("A2AClient", () => {
  it("should send a message and return a taskId", async () => {
    const taskId = crypto.randomUUID();
    const server = startMockServer(async (req) => {
      const body = await req.json() as { method: string };
      if (body.method === "message/send") {
        return Response.json({ jsonrpc: "2.0", result: { taskId }, id: null });
      }
      return Response.json({ jsonrpc: "2.0", error: { code: -32601, message: "Not found" }, id: null });
    });

    const layer = createA2AClient({ baseUrl: `http://localhost:${server.port}` });
    const result = await Effect.gen(function* () {
      const client = yield* A2AClient;
      return yield* client.sendMessage({
        message: {
          role: "user",
          parts: [{ kind: "text", text: "Hello" }],
        },
      });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(result.taskId).toBe(taskId);
  });

  it("should retrieve a task by id", async () => {
    const taskId = "task-123";
    const server = startMockServer(async (req) => {
      const body = await req.json() as { method: string; params: { id: string } };
      if (body.method === "tasks/get") {
        return Response.json({
          jsonrpc: "2.0",
          result: {
            id: body.params.id,
            status: { state: "completed", timestamp: new Date().toISOString() },
          },
          id: null,
        });
      }
      return Response.json({ jsonrpc: "2.0", error: { code: -32601, message: "Not found" }, id: null });
    });

    const layer = createA2AClient({ baseUrl: `http://localhost:${server.port}` });
    const task = await Effect.gen(function* () {
      const client = yield* A2AClient;
      return yield* client.getTask({ id: taskId });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(task.id).toBe(taskId);
    expect(task.status.state).toBe("completed");
  });

  it("should cancel a task and get canceled state", async () => {
    const taskId = "task-to-cancel";
    const server = startMockServer(async (req) => {
      const body = await req.json() as { method: string; params: { id: string } };
      if (body.method === "tasks/cancel") {
        return Response.json({
          jsonrpc: "2.0",
          result: {
            id: body.params.id,
            status: { state: "canceled", message: "Canceled by user", timestamp: new Date().toISOString() },
          },
          id: null,
        });
      }
      return Response.json({ jsonrpc: "2.0", error: { code: -32601, message: "Not found" }, id: null });
    });

    const layer = createA2AClient({ baseUrl: `http://localhost:${server.port}` });
    const task = await Effect.gen(function* () {
      const client = yield* A2AClient;
      return yield* client.cancelTask({ id: taskId });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(task.id).toBe(taskId);
    expect(task.status.state).toBe("canceled");
  });

  it("should fetch agent card from a URL", async () => {
    const server = startMockServer(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/agent/card") {
        return Response.json({
          name: "Remote Agent",
          version: "1.0.0",
          url: `http://localhost:${(server as any).port}`,
          provider: { organization: "Test" },
          capabilities: { streaming: false },
        });
      }
      return new Response("Not Found", { status: 404 });
    });

    const layer = createA2AClient({ baseUrl: `http://localhost:${server.port}` });
    const card = await Effect.gen(function* () {
      const client = yield* A2AClient;
      return yield* client.getAgentCard(`http://localhost:${server.port}`);
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(card.name).toBe("Remote Agent");
    expect(card.version).toBe("1.0.0");
  });

  it("should return TransportError on connection failure", async () => {
    // Use a port that nothing is listening on
    const layer = createA2AClient({ baseUrl: "http://localhost:19999" });
    const error = await Effect.gen(function* () {
      const client = yield* A2AClient;
      return yield* client.sendMessage({
        message: {
          role: "user",
          parts: [{ kind: "text", text: "Hello" }],
        },
      });
    }).pipe(
      Effect.provide(layer),
      Effect.flip,
      Effect.runPromise,
    );

    expect(error._tag).toBe("TransportError");
  });

  it("should propagate server-side JSON-RPC errors", async () => {
    const server = startMockServer(async () => {
      return Response.json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Task not found" },
        id: null,
      });
    });

    const layer = createA2AClient({ baseUrl: `http://localhost:${server.port}` });
    const error = await Effect.gen(function* () {
      const client = yield* A2AClient;
      return yield* client.getTask({ id: "nonexistent" });
    }).pipe(
      Effect.provide(layer),
      Effect.flip,
      Effect.runPromise,
    );

    expect(error._tag).toBe("TransportError");
  });
});
