import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";

describe("Gateway loop EventBus publishing", () => {
  test("ProactiveActionInitiated event has correct structure", async () => {
    const published: any[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* eb.on("ProactiveActionInitiated", (event) => {
          published.push(event);
          return Effect.void;
        });
        yield* eb.publish({
          _tag: "ProactiveActionInitiated",
          agentId: "test-agent",
          source: "heartbeat",
          taskDescription: "Check for work",
          timestamp: Date.now(),
        });
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(published).toHaveLength(1);
    expect(published[0].source).toBe("heartbeat");
    expect(published[0].taskDescription).toBe("Check for work");
  });

  test("ProactiveActionCompleted event has correct structure", async () => {
    const published: any[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* eb.on("ProactiveActionCompleted", (event) => {
          published.push(event);
          return Effect.void;
        });
        yield* eb.publish({
          _tag: "ProactiveActionCompleted",
          agentId: "test-agent",
          source: "heartbeat",
          success: true,
          tokensUsed: 150,
          durationMs: 2300,
          timestamp: Date.now(),
        });
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(published).toHaveLength(1);
    expect(published[0].success).toBe(true);
    expect(published[0].tokensUsed).toBe(150);
    expect(published[0].durationMs).toBe(2300);
  });

  test("ChannelMessageReceived event has correct structure for routing", async () => {
    const published: any[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* eb.on("ChannelMessageReceived", (event) => {
          published.push(event);
          return Effect.void;
        });
        yield* eb.publish({
          _tag: "ChannelMessageReceived",
          sender: "+15551234567",
          platform: "signal",
          message: "What's the server status?",
          timestamp: Date.now(),
          mcpServer: "signal",
        });
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(published).toHaveLength(1);
    expect(published[0].sender).toBe("+15551234567");
    expect(published[0].platform).toBe("signal");
    expect(published[0].message).toBe("What's the server status?");
    expect(published[0].mcpServer).toBe("signal");
  });
});
