import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { EventBus, EventBusLive } from "../src/services/event-bus.js";

describe("ChannelMessageReceived event", () => {
  test("EventBus accepts and delivers ChannelMessageReceived", async () => {
    const received: unknown[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* eb.on("ChannelMessageReceived", (event) => {
          received.push(event);
          return Effect.void;
        });
        yield* eb.publish({
          _tag: "ChannelMessageReceived",
          sender: "+15551234567",
          platform: "signal",
          message: "Hello agent",
          timestamp: Date.now(),
          mcpServer: "signal",
        });
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(received).toHaveLength(1);
    expect((received[0] as any)._tag).toBe("ChannelMessageReceived");
    expect((received[0] as any).sender).toBe("+15551234567");
    expect((received[0] as any).platform).toBe("signal");
  });
});
