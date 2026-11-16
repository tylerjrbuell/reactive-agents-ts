import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import { EventBus, EventBusLive } from "../src/index.js";
import type { AgentEvent, AgentEventTag, ChatModeChangedEvent } from "../src/index.js";

describe("ChatModeChanged event", () => {
  it("is an AgentEvent member (type level)", () => {
    const tag: AgentEventTag = "ChatModeChanged";
    const event: AgentEvent = { _tag: "ChatModeChanged", sessionId: "s1", from: "execute", to: "plan", timestamp: 1 };
    expect(event._tag).toBe(tag);
  });

  it("round-trips through EventBus.on with narrowing", async () => {
    const got = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const ref = yield* Ref.make<ChatModeChangedEvent | undefined>(undefined);
        yield* bus.on("ChatModeChanged", (e) => Ref.set(ref, e));
        yield* bus.publish({ _tag: "ChatModeChanged", sessionId: "s1", from: "plan", to: "execute", timestamp: 2 });
        return yield* Ref.get(ref);
      }).pipe(Effect.provide(EventBusLive)),
    );
    expect(got?.to).toBe("execute");
    expect(got?.sessionId).toBe("s1");
  });
});
