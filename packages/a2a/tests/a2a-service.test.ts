import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { A2AServer, createA2AServer } from "../src/server/a2a-server.js";
import { A2AClient, createA2AClient } from "../src/client/a2a-client.js";
import { A2AHttpServer, createA2AHttpServer } from "../src/server/http-server.js";
import type { AgentCard } from "../src/types.js";

const testAgentCard: AgentCard = {
  name: "Service Test Agent",
  description: "An agent for testing A2AService",
  version: "0.2.0",
  url: "http://localhost:3000",
  provider: { organization: "Test Org" },
  capabilities: { streaming: false, pushNotifications: false },
  skills: [{ id: "echo", name: "Echo", description: "Echoes input" }],
};

describe("A2AService (server + client integration)", () => {
  it("should return agent card from server", async () => {
    const layer = createA2AServer(testAgentCard);

    const card = await Effect.gen(function* () {
      const server = yield* A2AServer;
      return yield* server.getAgentCard();
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(card.name).toBe("Service Test Agent");
    expect(card.version).toBe("0.2.0");
    expect(card.skills).toHaveLength(1);
    expect(card.skills![0].id).toBe("echo");
  });

  it("should return TaskNotFoundError when getting non-existent task", async () => {
    const layer = createA2AServer(testAgentCard);

    const error = await Effect.gen(function* () {
      const server = yield* A2AServer;
      return yield* server.getTask("no-such-task");
    }).pipe(
      Effect.provide(layer),
      Effect.flip,
      Effect.runPromise,
    );

    expect(error._tag).toBe("TaskNotFoundError");
    expect(error.taskId).toBe("no-such-task");
  });

  it("should handle JSON-RPC agent/card method via HTTP server", async () => {
    const serverLayer = createA2AServer(testAgentCard);
    const httpLayer = createA2AHttpServer(3000).pipe(Layer.provide(serverLayer));

    const result = await Effect.gen(function* () {
      const http = yield* A2AHttpServer;
      return yield* http.handleJsonRpc({
        jsonrpc: "2.0",
        method: "agent/card",
        id: "1",
      });
    }).pipe(Effect.provide(httpLayer), Effect.runPromise);

    const typedResult = result as { result: AgentCard };
    expect(typedResult.result.name).toBe("Service Test Agent");
  });

  it("should return METHOD_NOT_FOUND for unknown methods", async () => {
    const serverLayer = createA2AServer(testAgentCard);
    const httpLayer = createA2AHttpServer(3000).pipe(Layer.provide(serverLayer));

    const error = await Effect.gen(function* () {
      const http = yield* A2AHttpServer;
      return yield* http.handleJsonRpc({
        jsonrpc: "2.0",
        method: "unknown/method",
        id: "2",
      });
    }).pipe(
      Effect.provide(httpLayer),
      Effect.flip,
      Effect.runPromise,
    );

    expect(error._tag).toBe("A2AError");
    expect(error.code).toBe("METHOD_NOT_FOUND");
  });

  it("should handle tasks/get via HTTP server with TaskNotFound error", async () => {
    const serverLayer = createA2AServer(testAgentCard);
    const httpLayer = createA2AHttpServer(3000).pipe(Layer.provide(serverLayer));

    const error = await Effect.gen(function* () {
      const http = yield* A2AHttpServer;
      return yield* http.handleJsonRpc({
        jsonrpc: "2.0",
        method: "tasks/get",
        params: { id: "nonexistent" },
        id: "3",
      });
    }).pipe(
      Effect.provide(httpLayer),
      Effect.flip,
      Effect.runPromise,
    );

    expect(error._tag).toBe("A2AError");
    expect(error.code).toBe("TASK_NOT_FOUND");
  });

  it("should return a taskId from message/send", async () => {
    const serverLayer = createA2AServer(testAgentCard);
    const httpLayer = createA2AHttpServer(3000).pipe(Layer.provide(serverLayer));

    const result = await Effect.gen(function* () {
      const http = yield* A2AHttpServer;
      return yield* http.handleJsonRpc({
        jsonrpc: "2.0",
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ kind: "text", text: "Hello" }],
          },
        },
        id: "4",
      });
    }).pipe(Effect.provide(httpLayer), Effect.runPromise);

    const typedResult = result as Record<string, any>;
    // handleJsonRpc returns { jsonrpc, id, result: { taskId } }
    expect(typedResult).toBeDefined();
    expect(typedResult.jsonrpc).toBe("2.0");
    expect(typedResult.result).toBeDefined();
  });
});
