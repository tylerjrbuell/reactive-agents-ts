import { describe, it, expect } from "bun:test";
import { Effect, ManagedRuntime, Layer, Stream } from "effect";
import { startStreamPump } from "../src/agent/stream-pump.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

const text = (delta: string): AgentStreamEvent => ({ _tag: "TextDelta", text: delta });
const rt = () => ManagedRuntime.make(Layer.empty);

describe("startStreamPump", () => {
  it("delivers events in order, then the done sentinel", async () => {
    const runtime = rt();
    const pump = startStreamPump(runtime, Stream.fromIterable([text("a"), text("b")]), undefined);
    const seen: string[] = [];
    for (let item = await pump.next(); item !== undefined; item = await pump.next()) {
      if (item.done) {
        seen.push("<done>");
        break;
      }
      seen.push(item.value._tag === "TextDelta" ? item.value.text : item.value._tag);
    }
    pump.dispose();
    expect(seen).toEqual(["a", "b", "<done>"]);
    await runtime.dispose();
  });

  it("surfaces a stream failure as a done item carrying the error", async () => {
    const runtime = rt();
    const pump = startStreamPump(runtime, Stream.fail(new Error("kaboom")), undefined);
    const item = await pump.next();
    pump.dispose();
    expect(item).toMatchObject({ done: true });
    expect(String((item as { error?: unknown }).error)).toContain("kaboom");
    await runtime.dispose();
  });

  it("returns undefined when the signal aborts while waiting on a stalled stream", async () => {
    const runtime = rt();
    const ac = new AbortController();
    const pump = startStreamPump(runtime, Stream.never, ac.signal);
    const waiting = pump.next();
    ac.abort();
    expect(await waiting).toBeUndefined();
    pump.dispose();
    await runtime.dispose();
  });

  it("dispose() interrupts the producer fiber (no events after dispose)", async () => {
    const runtime = rt();
    let emitted = 0;
    const ticking = Stream.repeatEffect(Effect.sleep("5 millis").pipe(Effect.as(text("t")), Effect.tap(() => Effect.sync(() => void emitted++))));
    const pump = startStreamPump(runtime, ticking, undefined);
    await pump.next();
    pump.dispose();
    const atDispose = emitted;
    await new Promise((r) => setTimeout(r, 60));
    expect(emitted - atDispose).toBeLessThanOrEqual(1);
    await runtime.dispose();
  });
});
