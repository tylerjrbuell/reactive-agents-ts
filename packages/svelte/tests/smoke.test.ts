/**
 * Smoke + behavioral coverage for `@reactive-agents/svelte` — closes HS-26
 * (svelte portion of #82). Vue portion tracked as separate follow-up bundle.
 *
 * Unlike React hooks, Svelte store factories (`createAgent`, `createAgentStream`)
 * are pure functions — no render context required, so we can call them
 * directly under `bun:test`. This gives real behavioral coverage of state
 * transitions via `subscribe` callbacks + a mocked `fetch`.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createAgent,
  createAgentStream,
  type AgentStreamEvent,
  type AgentHookState,
  type UseAgentReturn,
  type UseAgentStreamReturn,
  type AgentState,
  type AgentStreamState,
} from "../src/index.js";

type FetchFn = typeof globalThis.fetch;

function captureSubscribe<T>(store: { subscribe: (cb: (v: T) => void) => () => void }) {
  const states: T[] = [];
  const unsub = store.subscribe((s) => states.push(s));
  return { states, unsub };
}

describe("@reactive-agents/svelte — public surface", () => {
  it("exports createAgent + createAgentStream as functions", () => {
    expect(typeof createAgent).toBe("function");
    expect(typeof createAgentStream).toBe("function");
  });

  it("type-checks AgentHookState union", () => {
    const states: AgentHookState[] = ["idle", "streaming", "completed", "error"];
    expect(states.length).toBe(4);
  });

  it("type-checks AgentStreamEvent._tag variants (load-bearing SSE contract)", () => {
    const td: AgentStreamEvent = { _tag: "TextDelta", text: "x" } as AgentStreamEvent;
    const sc: AgentStreamEvent = { _tag: "StreamCompleted", output: "y" } as AgentStreamEvent;
    const sx: AgentStreamEvent = { _tag: "StreamCancelled" } as AgentStreamEvent;
    const se: AgentStreamEvent = { _tag: "StreamError", cause: "boom" } as AgentStreamEvent;
    expect([td._tag, sc._tag, sx._tag, se._tag]).toEqual([
      "TextDelta",
      "StreamCompleted",
      "StreamCancelled",
      "StreamError",
    ]);
  });

  it("type-checks UseAgentReturn + UseAgentStreamReturn shapes (re-exported from runtime SSE contract)", () => {
    const _useAgent: () => UseAgentReturn = () => ({
      output: null,
      loading: false,
      error: null,
      run: async () => "",
    });
    const _useStream: () => UseAgentStreamReturn = () => ({
      text: "",
      events: [],
      status: "idle",
      error: null,
      output: null,
      run: () => undefined,
      cancel: () => undefined,
    });
    expect(typeof _useAgent).toBe("function");
    expect(typeof _useStream).toBe("function");
  });
});

describe("createAgent — behavioral", () => {
  let originalFetch: FetchFn | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("returns a store with subscribe + run", () => {
    const agent = createAgent("/api/agent");
    expect(typeof agent.subscribe).toBe("function");
    expect(typeof agent.run).toBe("function");
  });

  it("initializes store with idle shape", () => {
    const agent = createAgent("/api/agent");
    const { states, unsub } = captureSubscribe<AgentState>(agent);
    expect(states[0]).toEqual({ output: null, loading: false, error: null });
    unsub();
  });

  it("transitions loading → output on successful fetch", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ output: "hello world" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as FetchFn;

    const agent = createAgent("/api/agent");
    const { states, unsub } = captureSubscribe<AgentState>(agent);

    const result = await agent.run("hi");
    expect(result).toBe("hello world");

    // Expect: idle → loading → completed
    expect(states[0]).toEqual({ output: null, loading: false, error: null });
    expect(states.some((s) => s.loading === true)).toBe(true);
    const final = states[states.length - 1]!;
    expect(final.loading).toBe(false);
    expect(final.output).toBe("hello world");
    expect(final.error).toBeNull();

    unsub();
  });

  it("transitions to error state on non-OK response", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 500, statusText: "Internal Server Error" })) as FetchFn;

    const agent = createAgent("/api/agent");
    const { states, unsub } = captureSubscribe<AgentState>(agent);

    await expect(agent.run("hi")).rejects.toThrow(/HTTP 500/);

    const final = states[states.length - 1]!;
    expect(final.loading).toBe(false);
    expect(final.error).toContain("HTTP 500");
    expect(final.output).toBeNull();

    unsub();
  });
});

describe("createAgentStream — behavioral", () => {
  let originalFetch: FetchFn | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("returns a store with subscribe + run + cancel", () => {
    const agent = createAgentStream("/api/agent");
    expect(typeof agent.subscribe).toBe("function");
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.cancel).toBe("function");
  });

  it("initializes store with idle shape", () => {
    const agent = createAgentStream("/api/agent");
    const { states, unsub } = captureSubscribe<AgentStreamState>(agent);
    expect(states[0]).toEqual({
      text: "",
      events: [],
      status: "idle",
      error: null,
      output: null,
    });
    unsub();
  });

  it("accumulates TextDelta events and completes on StreamCompleted", async () => {
    // Encode an SSE stream with 3 deltas + a completion event
    const sseBody = [
      `data: ${JSON.stringify({ _tag: "TextDelta", text: "Hel" })}`,
      "",
      `data: ${JSON.stringify({ _tag: "TextDelta", text: "lo " })}`,
      "",
      `data: ${JSON.stringify({ _tag: "TextDelta", text: "world" })}`,
      "",
      `data: ${JSON.stringify({ _tag: "StreamCompleted", output: "Hello world" })}`,
      "",
    ].join("\n");

    globalThis.fetch = (async () =>
      new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })) as FetchFn;

    const agent = createAgentStream("/api/agent");
    const { states, unsub } = captureSubscribe<AgentStreamState>(agent);

    await agent.run("hi");

    const final = states[states.length - 1]!;
    expect(final.status).toBe("completed");
    expect(final.text).toBe("Hello world");
    expect(final.output).toBe("Hello world");
    expect(final.events.length).toBe(4);
    expect(final.events.map((e) => e._tag)).toEqual([
      "TextDelta",
      "TextDelta",
      "TextDelta",
      "StreamCompleted",
    ]);

    unsub();
  });

  it("transitions to error state on StreamError event", async () => {
    const sseBody = [
      `data: ${JSON.stringify({ _tag: "StreamError", cause: "model exploded" })}`,
      "",
    ].join("\n");

    globalThis.fetch = (async () =>
      new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })) as FetchFn;

    const agent = createAgentStream("/api/agent");
    const { states, unsub } = captureSubscribe<AgentStreamState>(agent);

    await agent.run("hi");

    const final = states[states.length - 1]!;
    expect(final.status).toBe("error");
    expect(final.error).toBe("model exploded");

    unsub();
  });

  it("cancel() returns the store to idle", () => {
    const agent = createAgentStream("/api/agent");
    const { states, unsub } = captureSubscribe<AgentStreamState>(agent);

    agent.cancel();

    const final = states[states.length - 1]!;
    expect(final.status).toBe("idle");

    unsub();
  });
});
