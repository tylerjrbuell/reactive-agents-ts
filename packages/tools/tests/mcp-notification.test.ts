import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";

describe("MCP notification forwarding", () => {
  test("ChannelMessageReceived event has correct structure", async () => {
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
          message: "Hello from Signal",
          timestamp: Date.now(),
          mcpServer: "signal",
        });
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(published).toHaveLength(1);
    expect(published[0].sender).toBe("+15551234567");
    expect(published[0].platform).toBe("signal");
    expect(published[0].mcpServer).toBe("signal");
  });

  test("ChannelMessageReceived event with groupId", async () => {
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
          sender: "+15559876543",
          platform: "signal",
          message: "Group message",
          timestamp: Date.now(),
          mcpServer: "signal",
          groupId: "group-abc-123",
        });
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(published).toHaveLength(1);
    expect(published[0].groupId).toBe("group-abc-123");
    expect(published[0].message).toBe("Group message");
  });
});
