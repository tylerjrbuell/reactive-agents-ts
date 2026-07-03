/**
 * Behavioral coverage for `createStructuredStream` — structured SSE binding.
 * Mock fetch emits TextDelta events carrying JSON fragments, then StreamCompleted.
 * Mirrors the smoke.test.ts mock pattern exactly.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createStructuredStream, type StructuredStreamState } from "../src/index.js";

type FetchFn = typeof globalThis.fetch;

function captureSubscribe<T>(store: { subscribe: (cb: (v: T) => void) => () => void }) {
  const states: T[] = [];
  const unsub = store.subscribe((s) => states.push(s));
  return { states, unsub };
}

describe("createStructuredStream — public surface", () => {
  it("returns a store with subscribe + run + cancel", () => {
    const stream = createStructuredStream("/api/agent/structured");
    expect(typeof stream.subscribe).toBe("function");
    expect(typeof stream.run).toBe("function");
    expect(typeof stream.cancel).toBe("function");
  });

  it("initializes store with idle shape", () => {
    const stream = createStructuredStream("/api/agent/structured");
    const { states, unsub } = captureSubscribe<StructuredStreamState>(stream);
    expect(states[0]).toEqual({ object: {}, text: "", status: "idle", error: null });
    unsub();
  });
});

describe("createStructuredStream — behavioral", () => {
  let originalFetch: FetchFn | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("updates object progressively as TextDelta events arrive", async () => {
    // Stream partial JSON: '{"a":' then '1}' — object should be {} then {} then {a:1}
    const sseBody = [
      `data: ${JSON.stringify({ _tag: "TextDelta", text: '{"a":' })}`,
      "",
      `data: ${JSON.stringify({ _tag: "TextDelta", text: "1}" })}`,
      "",
      `data: ${JSON.stringify({ _tag: "StreamCompleted", output: '{"a":1}' })}`,
      "",
    ].join("\n");

    globalThis.fetch = (async () =>
      new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })) as FetchFn;

    const stream = createStructuredStream("/api/agent/structured");
    const { states, unsub } = captureSubscribe<StructuredStreamState>(stream);

    await stream.run("generate");

    const final = states[states.length - 1]!;
    expect(final.status).toBe("completed");
    expect(final.object).toEqual({ a: 1 });
    expect(final.text).toBe('{"a":1}');
    expect(final.error).toBeNull();

    unsub();
  });

  it("final object comes from StreamCompleted.output, not just accumulated text", async () => {
    const sseBody = [
      `data: ${JSON.stringify({ _tag: "TextDelta", text: '{"name":"Alice","age":' })}`,
      "",
      `data: ${JSON.stringify({ _tag: "TextDelta", text: "30}" })}`,
      "",
      `data: ${JSON.stringify({ _tag: "StreamCompleted", output: '{"name":"Alice","age":30}' })}`,
      "",
    ].join("\n");

    globalThis.fetch = (async () =>
      new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })) as FetchFn;

    const stream = createStructuredStream("/api/agent/structured");
    await stream.run("hi");

    // subscribe to get final state
    let finalState: StructuredStreamState | undefined;
    const unsub = stream.subscribe((s) => { finalState = s; });

    expect(finalState!.status).toBe("completed");
    expect(finalState!.object).toEqual({ name: "Alice", age: 30 });

    unsub();
  });

  it("transitions to error on StreamError event", async () => {
    const sseBody = [
      `data: ${JSON.stringify({ _tag: "StreamError", cause: "structured boom" })}`,
      "",
    ].join("\n");

    globalThis.fetch = (async () =>
      new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })) as FetchFn;

    const stream = createStructuredStream("/api/agent/structured");
    const { states, unsub } = captureSubscribe<StructuredStreamState>(stream);

    await stream.run("hi");

    const final = states[states.length - 1]!;
    expect(final.status).toBe("error");
    expect(final.error).toBe("structured boom");

    unsub();
  });

  it("transitions to error on non-OK HTTP response", async () => {
    globalThis.fetch = (async () =>
      new Response("err", { status: 500, statusText: "Internal Server Error" })) as FetchFn;

    const stream = createStructuredStream("/api/agent/structured");
    const { states, unsub } = captureSubscribe<StructuredStreamState>(stream);

    await stream.run("hi");

    const final = states[states.length - 1]!;
    expect(final.status).toBe("error");
    expect(final.error).toContain("HTTP 500");

    unsub();
  });

  it("cancel() returns the store to idle", () => {
    const stream = createStructuredStream("/api/agent/structured");
    const { states, unsub } = captureSubscribe<StructuredStreamState>(stream);

    stream.cancel();

    const final = states[states.length - 1]!;
    expect(final.status).toBe("idle");

    unsub();
  });

  it("threads requestInit (e.g. custom headers) into the underlying fetch", async () => {
    let capturedInit: RequestInit | undefined;

    const sseBody = [
      `data: ${JSON.stringify({ _tag: "StreamCompleted", output: "{}" })}`,
      "",
    ].join("\n");

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as FetchFn;

    const stream = createStructuredStream("/api/agent/structured", {
      headers: { "X-Test": "1" },
    });

    await stream.run("hi");

    expect(capturedInit).toBeDefined();
    const headers = capturedInit!.headers as Record<string, string>;
    expect(headers["X-Test"]).toBe("1");
  });
});
