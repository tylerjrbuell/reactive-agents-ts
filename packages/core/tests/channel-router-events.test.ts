import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { EventBus, EventBusLive } from "../src/services/event-bus.js";
import type { AgentEvent } from "../src/types/agent-event.js";

describe("channel router event contract pins", () => {
  test("EventBus delivers typed router events", async () => {
    const received: AgentEvent[] = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* eb.on("ChannelTurnCompleted", (event) => {
          received.push(event);
          return Effect.void;
        });
        yield* eb.publish({
          _tag: "ChannelTurnCompleted",
          routeId: "r1",
          role: "member",
          ok: true,
          runId: "run-1",
          tokens: 42,
          costUsd: 0.01,
          simulated: false,
        });
      }).pipe(Effect.provide(EventBusLive)),
    );
    expect(received).toHaveLength(1);
  });

  test("members compile with minimal payloads", () => {
    const events: AgentEvent[] = [
      { _tag: "ChannelRouteMatched", routeId: "r", channelId: "c", role: "owner" },
      { _tag: "ChannelRouteDenied", routeId: "r", channelId: "c" },
      { _tag: "ChannelUnrouted", channelId: "c" },
      { _tag: "ChannelTurnStarted", routeId: "r", role: "owner" },
      { _tag: "ChannelTurnDropped", routeId: "r", reason: "backpressure" },
      { _tag: "ChannelOwnershipChanged", channelId: "c", state: "conflict" },
      { _tag: "ChannelDeliveryFailed", adapterId: "a", kind: "conflict", retryable: false },
    ];
    expect(events).toHaveLength(7);
  });
});
