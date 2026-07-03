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

  it("streams TextDelta into liveText and exposes it mid-stream", async () => {
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

    const liveSnapshots: string[] = [];
    const unsub = chatStore.subscribe((s) => {
      const a = [...s.activeTurns].reverse().find((t) => t.role === "assistant");
      if (a?.liveText) liveSnapshots.push(a.liveText);
    });

    await chatStore.sendMessageStream("give me last commits");
    unsub();

    // Mid-stream: deltas were visible as liveText (the live answer preview)
    expect(liveSnapshots.some((t) => t.includes("Checking repo state..."))).toBe(true);
    expect(
      liveSnapshots.some((t) => t.includes("Checking repo state... gathering last five commits...")),
    ).toBe(true);

    const state = get(chatStore);
    const assistant = [...state.activeTurns].reverse().find((t) => t.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant?.content).toBe("Final table");
    // liveText cleared once the stream completes
    expect(assistant?.liveText).toBeUndefined();
  });

  it("folds liveText into the previous step's thought when a new iteration starts", async () => {
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
          'data: {"_tag":"TextDelta","text":"I will search the repo first."}\n\n',
          'data: {"_tag":"IterationProgress","iteration":2,"maxIterations":3,"status":"iteration 2/3"}\n\n',
          'data: {"_tag":"TextDelta","text":"Here is the final summary."}\n\n',
          'data: {"_tag":"StreamCompleted","output":"Here is the final summary.","metadata":{"tokensUsed":50,"iterations":2}}\n\n',
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
    await chatStore.sendMessageStream("summarize repo");

    const state = get(chatStore);
    const assistant = [...state.activeTurns].reverse().find((t) => t.role === "assistant");
    expect(assistant).toBeDefined();
    // Iteration-1 streaming text folded into step 1 thought when iteration 2 began
    const step1 = assistant?.reasoningSteps?.find((s) => s.iteration === 1);
    expect(step1?.thought).toContain("I will search the repo first.");
    // Final answer is authoritative output, not polluted with step-1 text
    expect(assistant?.content).toBe("Here is the final summary.");
    expect(assistant?.liveText).toBeUndefined();
  });

  it("exposes a partial structured object as JSON-shaped TextDelta chunks stream in (op E)", async () => {
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
        // Fragment 1: `{"a":1,` — a self-closable prefix (partial parse succeeds).
        // Fragment 2: `"b":2}` — completes the object.
        return sseStreamResponse([
          'data: {"_tag":"TextDelta","text":"{\\"a\\":1,"}\n\n',
          'data: {"_tag":"TextDelta","text":"\\"b\\":2}"}\n\n',
          'data: {"_tag":"StreamCompleted","output":"{\\"a\\":1,\\"b\\":2}","metadata":{"tokensUsed":10,"iterations":1}}\n\n',
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

    const liveObjectSnapshots: Record<string, unknown>[] = [];
    const unsub = chatStore.subscribe((s) => {
      const a = [...s.activeTurns].reverse().find((t) => t.role === "assistant");
      if (a?.liveObject) liveObjectSnapshots.push(a.liveObject);
    });

    await chatStore.sendMessageStream("give me a structured object");
    unsub();

    // Mid-stream: after the first fragment alone, the partial parse already
    // yields a key ("a") even though the object is not yet complete.
    expect(liveObjectSnapshots.some((o) => o.a === 1 && !("b" in o))).toBe(true);

    const state = get(chatStore);
    const assistant = [...state.activeTurns].reverse().find((t) => t.role === "assistant");
    expect(assistant).toBeDefined();
    // End-of-stream: the object is fully assembled from all deltas.
    expect(assistant?.liveObject).toEqual({ a: 1, b: 2 });
    // The existing text-authoritative behavior is untouched by the op-E addition.
    expect(assistant?.content).toBe('{"a":1,"b":2}');
  });
});
