import { afterEach, describe, expect, it } from "bun:test";
import { get } from "svelte/store";
import { chatStore } from "./chat-store.js";

type FetchFn = typeof fetch;
const originalFetch = globalThis.fetch;

function sseStreamResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(enc.encode(line));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("chatStore stream completion handling", () => {
  it("uses StreamCompleted output as authoritative final assistant content", async () => {
    const fetchImpl: FetchFn = (async (url: string) => {
      if (url.endsWith("/api/chat/sessions")) {
        return new Response(
          JSON.stringify([
            {
              sessionId: "s1",
              name: "S1",
              agentConfig: {},
              createdAt: Date.now(),
              lastUsedAt: Date.now(),
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/api/chat/sessions/s1")) {
        return new Response(
          JSON.stringify({
            sessionId: "s1",
            name: "S1",
            agentConfig: {},
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            turns: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/api/chat/sessions/s1/chat/stream")) {
        return sseStreamResponse([
          'data: {"_tag":"TextDelta","text":"Draft answer..."}\n\n',
          'data: {"_tag":"StreamCompleted","output":"| sha | message | date |\\n|---|---|---|","metadata":{"tokensUsed":42,"iterations":2}}\n\n',
        ]);
      }

      return new Response(JSON.stringify({ error: "unexpected url" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as FetchFn;

    globalThis.fetch = fetchImpl;

    await chatStore.loadSessions();
    await chatStore.selectSession("s1");
    await chatStore.sendMessageStream("render markdown table");

    const state = get(chatStore);
    const assistant = [...state.activeTurns].reverse().find((t) => t.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant?.content).toContain("| sha | message | date |");
    expect(assistant?.content).not.toContain("Draft answer...");
  });

  it("appends streamed thought chunks under the same reasoning step", async () => {
    const fetchImpl: FetchFn = (async (url: string) => {
      if (url.endsWith("/api/chat/sessions")) {
        return new Response(
          JSON.stringify([
            {
              sessionId: "s1",
              name: "S1",
              agentConfig: {},
              createdAt: Date.now(),
              lastUsedAt: Date.now(),
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/api/chat/sessions/s1")) {
        return new Response(
          JSON.stringify({
            sessionId: "s1",
            name: "S1",
            agentConfig: {},
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            turns: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/api/chat/sessions/s1/chat/stream")) {
        return sseStreamResponse([
          'data: {"_tag":"IterationProgress","iteration":1,"maxIterations":5,"status":"iteration 1/5"}\n\n',
          'data: {"_tag":"ThoughtEmitted","iteration":1,"content":"Find candidate commits"}\n\n',
          'data: {"_tag":"ThoughtEmitted","iteration":1,"content":"Filter by date window"}\n\n',
          'data: {"_tag":"StreamCompleted","output":"Done","metadata":{"tokensUsed":21,"iterations":1}}\n\n',
        ]);
      }

      return new Response(JSON.stringify({ error: "unexpected url" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as FetchFn;

    globalThis.fetch = fetchImpl;

    await chatStore.loadSessions();
    await chatStore.selectSession("s1");
    await chatStore.sendMessageStream("show commit highlights");

    const state = get(chatStore);
    const assistant = [...state.activeTurns].reverse().find((t) => t.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant?.reasoningSteps?.[0]?.thought).toContain("Find candidate commits");
    expect(assistant?.reasoningSteps?.[0]?.thought).toContain("Filter by date window");
  });

  it("routes TextDelta into reasoning step thought when reasoning progress is active", async () => {
    const fetchImpl: FetchFn = (async (url: string) => {
      if (url.endsWith("/api/chat/sessions")) {
        return new Response(
          JSON.stringify([
            {
              sessionId: "s1",
              name: "S1",
              agentConfig: {},
              createdAt: Date.now(),
              lastUsedAt: Date.now(),
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/api/chat/sessions/s1")) {
        return new Response(
          JSON.stringify({
            sessionId: "s1",
            name: "S1",
            agentConfig: {},
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            turns: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/api/chat/sessions/s1/chat/stream")) {
        return sseStreamResponse([
          'data: {"_tag":"IterationProgress","iteration":1,"maxIterations":3,"status":"iteration 1/3"}\n\n',
          'data: {"_tag":"TextDelta","text":"Checking repo state..."}\n\n',
          'data: {"_tag":"TextDelta","text":" gathering last five commits..."}\n\n',
          'data: {"_tag":"StreamCompleted","output":"Final table","metadata":{"tokensUsed":33,"iterations":1}}\n\n',
        ]);
      }

      return new Response(JSON.stringify({ error: "unexpected url" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as FetchFn;

    globalThis.fetch = fetchImpl;

    await chatStore.loadSessions();
    await chatStore.selectSession("s1");
    await chatStore.sendMessageStream("give me last commits");

    const state = get(chatStore);
    const assistant = [...state.activeTurns].reverse().find((t) => t.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant?.reasoningSteps?.[0]?.thought).toContain("Checking repo state...");
    expect(assistant?.reasoningSteps?.[0]?.thought).toContain("gathering last five commits...");
    expect(assistant?.content).toBe("Final table");
  });
});
