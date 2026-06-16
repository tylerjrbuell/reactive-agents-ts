/**
 * Behavioral coverage for `useStructuredObject` — structured SSE composable.
 * Mock fetch emits TextDelta events carrying JSON fragments, then StreamCompleted.
 * Mirrors the smoke.test.ts mock pattern exactly.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { useStructuredObject } from "../src/index.js";

type FetchFn = typeof globalThis.fetch;

describe("useStructuredObject — public surface", () => {
  it("returns refs + run + cancel", () => {
    const stream = useStructuredObject("/api/agent/structured");
    expect(typeof stream.run).toBe("function");
    expect(typeof stream.cancel).toBe("function");
    expect(stream.object.value).toEqual({});
    expect(stream.text.value).toBe("");
    expect(stream.status.value).toBe("idle");
    expect(stream.error.value).toBeNull();
  });
});

describe("useStructuredObject — behavioral", () => {
  let originalFetch: FetchFn | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("updates object.value progressively as TextDelta events arrive", async () => {
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

    const stream = useStructuredObject("/api/agent/structured");
    await stream.run("generate");

    expect(stream.status.value).toBe("completed");
    expect(stream.object.value).toEqual({ a: 1 });
    expect(stream.text.value).toBe('{"a":1}');
    expect(stream.error.value).toBeNull();
  });

  it("final object.value comes from StreamCompleted.output", async () => {
    const sseBody = [
      `data: ${JSON.stringify({ _tag: "TextDelta", text: '{"name":"Bob","score":' })}`,
      "",
      `data: ${JSON.stringify({ _tag: "TextDelta", text: "99}" })}`,
      "",
      `data: ${JSON.stringify({ _tag: "StreamCompleted", output: '{"name":"Bob","score":99}' })}`,
      "",
    ].join("\n");

    globalThis.fetch = (async () =>
      new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })) as FetchFn;

    const stream = useStructuredObject("/api/agent/structured");
    await stream.run("hi");

    expect(stream.status.value).toBe("completed");
    expect(stream.object.value).toEqual({ name: "Bob", score: 99 });
  });

  it("flips status.value to 'error' on StreamError event", async () => {
    const sseBody = [
      `data: ${JSON.stringify({ _tag: "StreamError", cause: "vue structured boom" })}`,
      "",
    ].join("\n");

    globalThis.fetch = (async () =>
      new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })) as FetchFn;

    const stream = useStructuredObject("/api/agent/structured");
    await stream.run("hi");

    expect(stream.status.value).toBe("error");
    expect(stream.error.value).toBe("vue structured boom");
    expect(stream.object.value).toEqual({});
  });

  it("captures error.value when fetch returns non-OK status", async () => {
    globalThis.fetch = (async () =>
      new Response("err", { status: 502, statusText: "Bad Gateway" })) as FetchFn;

    const stream = useStructuredObject("/api/agent/structured");
    await stream.run("hi");

    expect(stream.status.value).toBe("error");
    expect(stream.error.value).toContain("HTTP 502");
  });

  it("cancel() flips status.value to 'idle'", () => {
    const stream = useStructuredObject("/api/agent/structured");
    stream.cancel();
    expect(stream.status.value).toBe("idle");
  });
});
