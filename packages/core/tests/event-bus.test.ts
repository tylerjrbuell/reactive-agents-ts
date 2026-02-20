import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import { EventBus, EventBusLive, CoreServicesLive } from "../src/index.js";
import type { AgentEvent } from "../src/index.js";

describe("EventBus", () => {
  const run = <A, E>(effect: Effect.Effect<A, E, EventBus>) =>
    Effect.runPromise(effect.pipe(Effect.provide(EventBusLive)));

  it("should publish and receive events", async () => {
    const received = await run(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const events = yield* Ref.make<AgentEvent[]>([]);

        yield* bus.subscribe((event) =>
          Ref.update(events, (es) => [...es, event]),
        );

        yield* bus.publish({ _tag: "TaskCreated", taskId: "t1" });
        yield* bus.publish({ _tag: "AgentCreated", agentId: "a1" });

        return yield* Ref.get(events);
      }),
    );

    expect(received.length).toBe(2);
    expect(received[0]._tag).toBe("TaskCreated");
    expect(received[1]._tag).toBe("AgentCreated");
  });

  it("should filter events with on()", async () => {
    const received = await run(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const events = yield* Ref.make<AgentEvent[]>([]);

        yield* bus.on("TaskCreated", (event) =>
          Ref.update(events, (es) => [...es, event]),
        );

        yield* bus.publish({ _tag: "TaskCreated", taskId: "t1" });
        yield* bus.publish({ _tag: "AgentCreated", agentId: "a1" });
        yield* bus.publish({ _tag: "TaskCreated", taskId: "t2" });

        return yield* Ref.get(events);
      }),
    );

    expect(received.length).toBe(2);
    expect(received.every((e) => e._tag === "TaskCreated")).toBe(true);
  });

  it("should support unsubscribe", async () => {
    const received = await run(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const events = yield* Ref.make<AgentEvent[]>([]);

        const unsub = yield* bus.subscribe((event) =>
          Ref.update(events, (es) => [...es, event]),
        );

        yield* bus.publish({ _tag: "TaskCreated", taskId: "t1" });
        unsub();
        yield* bus.publish({ _tag: "TaskCreated", taskId: "t2" });

        return yield* Ref.get(events);
      }),
    );

    expect(received.length).toBe(1);
  });

  it("should support multiple subscribers", async () => {
    const counts = await run(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const count1 = yield* Ref.make(0);
        const count2 = yield* Ref.make(0);

        yield* bus.subscribe(() => Ref.update(count1, (n) => n + 1));
        yield* bus.subscribe(() => Ref.update(count2, (n) => n + 1));

        yield* bus.publish({ _tag: "TaskCreated", taskId: "t1" });

        const c1 = yield* Ref.get(count1);
        const c2 = yield* Ref.get(count2);
        return { c1, c2 };
      }),
    );

    expect(counts.c1).toBe(1);
    expect(counts.c2).toBe(1);
  });
});
