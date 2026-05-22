/**
 * Smoke + behavioral coverage for `@reactive-agents/vue` — closes HS-26
 * vue portion (completes #82 with PRs #100 (react) + #101 (svelte)).
 *
 * Vue's Composition API `ref()` from `vue/reactivity` works outside a
 * component `setup()` scope — same framework-agnostic substrate as svelte
 * stores. Behavioral coverage is cheap via mocked `fetch` + `.value` reads.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  useAgent,
  useAgentStream,
  type AgentStreamEvent,
  type AgentHookState,
} from "../src/index.js";

type FetchFn = typeof globalThis.fetch;

describe("@reactive-agents/vue — public surface", () => {
  it("exports useAgent + useAgentStream as functions", () => {
    expect(typeof useAgent).toBe("function");
    expect(typeof useAgentStream).toBe("function");
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
});

describe("useAgent — behavioral", () => {
  let originalFetch: FetchFn | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("returns readonly refs + run function", () => {
    const agent = useAgent("/api/agent");
    expect(typeof agent.run).toBe("function");
    // Refs are objects with a `.value` accessor
    expect(agent.output.value).toBeNull();
    expect(agent.loading.value).toBe(false);
    expect(agent.error.value).toBeNull();
  });

  it("flips loading.value during fetch and resolves output on success", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ output: "vue says hi" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as FetchFn;

    const agent = useAgent("/api/agent");
    const promise = agent.run("hi");
    expect(agent.loading.value).toBe(true);

    const result = await promise;
    expect(result).toBe("vue says hi");
    expect(agent.loading.value).toBe(false);
    expect(agent.output.value).toBe("vue says hi");
    expect(agent.error.value).toBeNull();
  });

  it("captures error.value + re-throws on non-OK response", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 503, statusText: "Service Unavailable" })) as FetchFn;

    const agent = useAgent("/api/agent");
    await expect(agent.run("hi")).rejects.toThrow(/HTTP 503/);
    expect(agent.loading.value).toBe(false);
    expect(agent.error.value).toContain("HTTP 503");
    expect(agent.output.value).toBeNull();
  });

  it("falls back to data.result when data.output is absent", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ result: "fallback" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as FetchFn;

    const agent = useAgent("/api/agent");
    const result = await agent.run("hi");
    expect(result).toBe("fallback");
    expect(agent.output.value).toBe("fallback");
  });
});

describe("useAgentStream — behavioral", () => {
  let originalFetch: FetchFn | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("returns readonly refs + run + cancel", () => {
    const agent = useAgentStream("/api/agent");
    expect(typeof agent.run).toBe("function");
    expect(typeof agent.cancel).toBe("function");
    expect(agent.text.value).toBe("");
    expect(agent.events.value).toEqual([]);
    expect(agent.status.value).toBe("idle");
    expect(agent.error.value).toBeNull();
    expect(agent.output.value).toBeNull();
  });

  it("accumulates TextDelta + completes on StreamCompleted", async () => {
    const sseBody = [
      `data: ${JSON.stringify({ _tag: "TextDelta", text: "Hel" })}`,
      "",
      `data: ${JSON.stringify({ _tag: "TextDelta", text: "lo " })}`,
      "",
      `data: ${JSON.stringify({ _tag: "TextDelta", text: "vue" })}`,
      "",
      `data: ${JSON.stringify({ _tag: "StreamCompleted", output: "Hello vue" })}`,
      "",
    ].join("\n");

    globalThis.fetch = (async () =>
      new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })) as FetchFn;

    const agent = useAgentStream("/api/agent");
    await agent.run("hi");

    expect(agent.status.value).toBe("completed");
    expect(agent.text.value).toBe("Hello vue");
    expect(agent.output.value).toBe("Hello vue");
    expect(agent.events.value.length).toBe(4);
    expect(agent.events.value.map((e) => e._tag)).toEqual([
      "TextDelta",
      "TextDelta",
      "TextDelta",
      "StreamCompleted",
    ]);
  });

  it("flips status.value to 'error' on StreamError event", async () => {
    const sseBody = [
      `data: ${JSON.stringify({ _tag: "StreamError", cause: "vue boom" })}`,
      "",
    ].join("\n");

    globalThis.fetch = (async () =>
      new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })) as FetchFn;

    const agent = useAgentStream("/api/agent");
    await agent.run("hi");

    expect(agent.status.value).toBe("error");
    expect(agent.error.value).toBe("vue boom");
  });

  it("captures error.value when fetch rejects (non-OK status)", async () => {
    globalThis.fetch = (async () =>
      new Response("err", { status: 502, statusText: "Bad Gateway" })) as FetchFn;

    const agent = useAgentStream("/api/agent");
    await agent.run("hi");

    expect(agent.status.value).toBe("error");
    expect(agent.error.value).toContain("HTTP 502");
  });

  it("cancel() flips status.value to 'idle'", () => {
    const agent = useAgentStream("/api/agent");
    agent.cancel();
    expect(agent.status.value).toBe("idle");
  });
});
