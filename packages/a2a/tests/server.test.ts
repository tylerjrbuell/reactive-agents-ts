import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";
import { A2AServer, createA2AServer } from "../src/server/a2a-server.js";
import { AgentCardSchema } from "../src/types.js";

describe("A2AServer", () => {
  const testAgentCard = {
    id: "test-agent",
    name: "Test Agent",
    description: "A test agent",
    version: "0.1.0",
    url: "http://localhost:3000",
    provider: { organization: "Test Org" },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  };

  const testLayer = createA2AServer(testAgentCard);

  it("should return the agent card", async () => {
    const result = await Effect.gen(function* () {
      const server = yield* A2AServer;
      return yield* server.getAgentCard();
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(result.name).toBe("Test Agent");
    expect(result.id).toBe("test-agent");
  });

  it("should return TaskNotFoundError for non-existent task", async () => {
    const result = await Effect.gen(function* () {
      const server = yield* A2AServer;
      return yield* server.getTask("non-existent-id");
    }).pipe(
      Effect.provide(testLayer),
      Effect.flip,
      Effect.runPromise,
    );

    expect(result._tag).toBe("TaskNotFoundError");
  });
});
