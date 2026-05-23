import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import {
  EventBus,
  EventBusLive,
  emitErrorSwallowed,
  emitLoadBearingFailure,
  errorTag,
  type AgentEvent,
} from "../src/index.js";

describe("ErrorSwallowed event", () => {
  it("emits when emitErrorSwallowed is called inside a layer that provides EventBus", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const captured = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((event) => Ref.update(captured, (xs) => [...xs, event]));
        yield* emitErrorSwallowed({
          site: "test-site",
          tag: "TestError",
          taskId: "t1",
          message: "boom",
        });
        return yield* Ref.get(captured);
      }).pipe(Effect.provide(EventBusLive)),
    );

    const swallow = events.find((event) => event._tag === "ErrorSwallowed");
    expect(swallow).toBeDefined();
    if (swallow && swallow._tag === "ErrorSwallowed") {
      expect(swallow.site).toBe("test-site");
      expect(swallow.tag).toBe("TestError");
      expect(swallow.taskId).toBe("t1");
      expect(swallow.message).toBe("boom");
      expect(typeof swallow.timestamp).toBe("number");
    }
  }, 15000);

  it("is a no-op when EventBus is not provided (returns void)", async () => {
    const result = await Effect.runPromise(
      emitErrorSwallowed({ site: "no-bus", tag: "Nothing" }),
    );
    expect(result).toBeUndefined();
  }, 15000);

  it("errorTag reads _tag from a Data.TaggedError-shaped value", () => {
    const err = { _tag: "CustomError", message: "test" };
    expect(errorTag(err)).toBe("CustomError");
  });

  it("errorTag falls back to Error.name for native errors", () => {
    expect(errorTag(new TypeError("bad input"))).toBe("TypeError");
    expect(errorTag(new Error("generic"))).toBe("Error");
  });

  it("errorTag returns UnknownError for inputs without _tag or Error", () => {
    expect(errorTag("just a string")).toBe("UnknownError");
    expect(errorTag(null)).toBe("UnknownError");
    expect(errorTag(undefined)).toBe("UnknownError");
    expect(errorTag(42)).toBe("UnknownError");
    expect(errorTag({ notATag: "here" })).toBe("UnknownError");
  });

  it("errorTag ignores non-string _tag values", () => {
    expect(errorTag({ _tag: 42 })).toBe("UnknownError");
    expect(errorTag({ _tag: "" })).toBe("UnknownError");
  });
});

// HS-cleanup-3 — load-bearing failure primitive invariants.
describe("emitLoadBearingFailure", () => {
  it("publishes an ErrorSwallowed event tagged with LoadBearingFailure:<capability>", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const captured = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((event) => Ref.update(captured, (xs) => [...xs, event]));
        yield* emitLoadBearingFailure({
          capability: "skill-persistence",
          site: "test/path:1",
          tag: "StoreFail",
          entityId: "my-skill",
          message: "disk-full",
        });
        return yield* Ref.get(captured);
      }).pipe(Effect.provide(EventBusLive)),
    );

    const failure = events.find(
      (e) => e._tag === "ErrorSwallowed" && (e as any).tag === "LoadBearingFailure:skill-persistence",
    );
    expect(failure).toBeDefined();
    expect((failure as any).message).toContain("my-skill");
    expect((failure as any).message).toContain("disk-full");
    expect((failure as any).site).toBe("test/path:1");
  });

  it("never throws — succeeds with void even without EventBus", async () => {
    const result = await Effect.runPromise(
      emitLoadBearingFailure({
        capability: "memory-flush",
        site: "no-bus:1",
        tag: "Nope",
      }),
    );
    expect(result).toBeUndefined();
  });

  it("preserves capability in the tag so trace consumers can grep one canonical predicate", async () => {
    const tags = await Effect.runPromise(
      Effect.gen(function* () {
        const captured = yield* Ref.make<string[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((event) => {
          if (event._tag === "ErrorSwallowed") {
            return Ref.update(captured, (xs) => [...xs, event.tag]);
          }
          return Effect.void;
        });
        yield* emitLoadBearingFailure({ capability: "skill-persistence", site: "s", tag: "T" });
        yield* emitLoadBearingFailure({ capability: "debrief-persistence", site: "s", tag: "T" });
        yield* emitLoadBearingFailure({ capability: "memory-semantic-write", site: "s", tag: "T" });
        return yield* Ref.get(captured);
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(tags).toContain("LoadBearingFailure:skill-persistence");
    expect(tags).toContain("LoadBearingFailure:debrief-persistence");
    expect(tags).toContain("LoadBearingFailure:memory-semantic-write");
    // One canonical predicate matches all three:
    expect(tags.every((t) => t.startsWith("LoadBearingFailure:"))).toBe(true);
  });
});
