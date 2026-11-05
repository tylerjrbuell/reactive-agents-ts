import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { childRunScope, getRunSlot, streamSinkSlot, withRunScope } from "../src/internal/run-scope.js";
import { childContext, rootContext } from "../src/run-context.js";

const root = rootContext("run-s", "agent-s");

describe("streamSinkSlot", () => {
  it("starts empty in every run", async () => {
    const sink = await Effect.runPromise(getRunSlot(streamSinkSlot).pipe(withRunScope(root)));
    expect(sink.current).toBeNull();
  });

  it("a callback installed in the run's cell receives the run's text", async () => {
    const captured: string[] = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const sink = yield* getRunSlot(streamSinkSlot);
        sink.current = (text) => Effect.sync(() => void captured.push(text));
        const read = yield* getRunSlot(streamSinkSlot);
        if (read.current) yield* read.current("hello");
        if (read.current) yield* read.current(" world");
      }).pipe(withRunScope(root)),
    );
    expect(captured).toEqual(["hello", " world"]);
  });

  it("two runs never share a sink, and a sub-agent starts with none", async () => {
    const [first, second] = await Effect.runPromise(
      Effect.all([getRunSlot(streamSinkSlot).pipe(withRunScope(root)), getRunSlot(streamSinkSlot).pipe(withRunScope(root))]),
    );
    expect(first).not.toBe(second);
    const childSink = await Effect.runPromise(
      Effect.gen(function* () {
        const parent = yield* getRunSlot(streamSinkSlot);
        parent.current = () => Effect.void;
        return yield* getRunSlot(streamSinkSlot).pipe(childRunScope(childContext(root, "sub")));
      }).pipe(withRunScope(root)),
    );
    expect(childSink.current).toBeNull();
  });
});
