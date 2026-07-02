import { describe, expect, test } from "bun:test";
import { connectRunStream } from "../src/stream/connect.js";
import type { UiStreamEvent } from "../src/protocol/events.js";

const sse = (events: Array<{ seq?: number; event: object }>, opts?: { dropAfter?: number }) => {
  const chunks: string[] = [];
  events.forEach(({ seq, event }, i) => {
    if (opts?.dropAfter !== undefined && i >= opts.dropAfter) return;
    if (seq !== undefined) chunks.push(`id: ${seq}\n`);
    chunks.push(`data: ${JSON.stringify(event)}\n\n`);
  });
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      if (opts?.dropAfter !== undefined) {
        controller.error(new Error("network drop"));
      } else {
        controller.close();
      }
    },
  });
};

const okResponse = (body: ReadableStream<Uint8Array>) =>
  new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });

describe("connectRunStream", () => {
  test("yields parsed events and stops at terminal", async () => {
    const fetchImpl: typeof fetch = async () =>
      okResponse(
        sse([
          { seq: 1, event: { _tag: "TextDelta", text: "he" } },
          { seq: 2, event: { _tag: "TextDelta", text: "llo" } },
          { seq: 3, event: { _tag: "StreamCompleted", output: "hello", metadata: {} } },
        ]),
      );
    const got: UiStreamEvent[] = [];
    for await (const e of connectRunStream({ endpoint: "/api/agent", body: { prompt: "hi" }, fetchImpl })) {
      got.push(e);
    }
    expect(got.map((e) => e._tag)).toEqual(["TextDelta", "TextDelta", "StreamCompleted"]);
    expect((got[0] as { seq?: number }).seq).toBe(1);
  });

  test("reconnects from cursor after mid-stream drop", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    let call = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      call += 1;
      if (call === 1) {
        // first connection drops after 2 events
        return okResponse(
          sse(
            [
              { seq: 1, event: { _tag: "TextDelta", text: "a" } },
              { seq: 2, event: { _tag: "TextDelta", text: "b" } },
              { seq: 3, event: { _tag: "StreamCompleted", output: "ab", metadata: {} } },
            ],
            { dropAfter: 2 },
          ),
        );
      }
      // reconnect: server replays from cursor
      return okResponse(
        sse([{ seq: 3, event: { _tag: "StreamCompleted", output: "ab", metadata: {}, runId: "r1" } }]),
      );
    };
    const got: UiStreamEvent[] = [];
    for await (const e of connectRunStream({
      endpoint: "/api/agent",
      body: { prompt: "x" },
      attach: { runId: "r1" }, // enables reconnect target
      fetchImpl,
      retryDelayMs: 1,
    })) {
      got.push(e);
    }
    expect(got.map((e) => e._tag)).toEqual(["TextDelta", "TextDelta", "StreamCompleted"]);
    expect(calls.length).toBe(2);
    expect(calls[1]!.url).toContain("cursor=2");
    expect(calls[1]!.method).toBe("GET");
  });

  test("gives up after maxRetries and yields StreamError", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("refused");
    };
    const got: UiStreamEvent[] = [];
    for await (const e of connectRunStream({
      endpoint: "/api/agent",
      attach: { runId: "r9" },
      fetchImpl,
      maxRetries: 2,
      retryDelayMs: 1,
    })) {
      got.push(e);
    }
    expect(got.at(-1)?._tag).toBe("StreamError");
  });
});
