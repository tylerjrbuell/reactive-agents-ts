import { describe, it, expect } from "bun:test";
import { Stream } from "effect";
import type { AgentStreamEvent, StreamDensity } from "../src/stream-types.js";
import { AgentStream } from "../src/agent-stream.js";

describe("AgentStreamEvent types", () => {
  it("TextDelta has _tag and text", () => {
    const e: AgentStreamEvent = { _tag: "TextDelta", text: "hello" };
    expect(e._tag).toBe("TextDelta");
  });

  it("StreamCompleted carries output and metadata", () => {
    const e: AgentStreamEvent = {
      _tag: "StreamCompleted",
      output: "result",
      metadata: { duration: 100, cost: 0, tokensUsed: 50, stepsCount: 1 },
    };
    expect(e._tag).toBe("StreamCompleted");
  });

  it("StreamError carries cause", () => {
    const e: AgentStreamEvent = { _tag: "StreamError", cause: "timeout" };
    expect(e.cause).toBe("timeout");
  });

  it("StreamDensity is tokens or full", () => {
    const d1: StreamDensity = "tokens";
    const d2: StreamDensity = "full";
    expect(d1).toBe("tokens");
    expect(d2).toBe("full");
  });
});

describe("AgentStream adapters", () => {
  it("collect() resolves on StreamCompleted", async () => {
    const stream = Stream.make<AgentStreamEvent>(
      { _tag: "TextDelta", text: "hello " },
      { _tag: "TextDelta", text: "world" },
      {
        _tag: "StreamCompleted",
        output: "hello world",
        metadata: { duration: 100, cost: 0, tokensUsed: 10, stepsCount: 1 },
      },
    );
    const result = await AgentStream.collect(stream);
    expect(result.output).toBe("hello world");
    expect(result.success).toBe(true);
  });

  it("collect() rejects on StreamError", async () => {
    const stream = Stream.make<AgentStreamEvent>(
      { _tag: "StreamError", cause: "test failure" },
    );
    await expect(AgentStream.collect(stream)).rejects.toThrow("test failure");
  });

  it("collect() rejects if stream ends without terminal event", async () => {
    const stream = Stream.make<AgentStreamEvent>(
      { _tag: "TextDelta", text: "partial" },
    );
    await expect(AgentStream.collect(stream)).rejects.toThrow(
      "Stream ended without StreamCompleted event",
    );
  });

  it("toAsyncIterable() yields events in order", async () => {
    const events: AgentStreamEvent[] = [
      { _tag: "TextDelta", text: "a" },
      { _tag: "TextDelta", text: "b" },
      { _tag: "StreamCompleted", output: "ab", metadata: { duration: 50, cost: 0, tokensUsed: 5, stepsCount: 1 } },
    ];
    const stream = Stream.fromIterable(events);
    const received: AgentStreamEvent[] = [];
    for await (const event of AgentStream.toAsyncIterable(stream)) {
      received.push(event);
    }
    expect(received.length).toBe(3);
    expect(received[0]?._tag).toBe("TextDelta");
    expect(received[2]?._tag).toBe("StreamCompleted");
  });
});
