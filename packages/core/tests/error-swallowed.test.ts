import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import {
  EventBus,
  EventBusLive,
  emitErrorSwallowed,
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
