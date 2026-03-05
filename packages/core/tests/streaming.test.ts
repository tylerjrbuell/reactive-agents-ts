import { describe, it, expect } from "bun:test";
import { Effect, FiberRef } from "effect";
import { StreamingTextCallback } from "../src/streaming.js";

describe("StreamingTextCallback", () => {
  it("defaults to null", async () => {
    const val = await Effect.runPromise(FiberRef.get(StreamingTextCallback));
    expect(val).toBeNull();
  });

  it("can be set locally and read inside the fiber", async () => {
    const captured: string[] = [];
    const callback = (text: string) =>
      Effect.sync(() => {
        captured.push(text);
      });
    await Effect.runPromise(
      Effect.locally(
        Effect.gen(function* () {
          const cb = yield* FiberRef.get(StreamingTextCallback);
          if (cb) yield* cb("hello");
          if (cb) yield* cb(" world");
        }),
        StreamingTextCallback,
        callback,
      ),
    );
    expect(captured).toEqual(["hello", " world"]);
  });

  it("does not leak to outer fiber after locally", async () => {
    const callback = (_text: string) => Effect.void;
    await Effect.runPromise(
      Effect.locally(Effect.void, StreamingTextCallback, callback),
    );
    const val = await Effect.runPromise(FiberRef.get(StreamingTextCallback));
    expect(val).toBeNull();
  });
});
