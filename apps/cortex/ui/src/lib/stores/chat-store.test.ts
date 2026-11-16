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
            agentConfig: { outputSchema: { type: "object" } },
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

  it("keeps the user's message on a pre-stream HTTP failure and ends the reply as a failed turn with the cause (B1)", async () => {
    const fetchImpl: FetchFn = (async (url: string) => {
      if (url.endsWith("/api/chat/sessions")) {
        return new Response(
          JSON.stringify([
            { sessionId: "s1", name: "S1", agentConfig: {}, createdAt: Date.now(), lastUsedAt: Date.now() },
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
        // Connection failure before any SSE content: server unreachable / 5xx.
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "unexpected url" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as FetchFn;

    globalThis.fetch = fetchImpl;

    await chatStore.loadSessions();
    await chatStore.selectSession("s1");
    await chatStore.sendMessageStream("this will fail before any content streams");

    const state = get(chatStore);
    // B1 (2026-11-10 audit): the message stays, and the reply is a failed turn with
    // the cause and Retry, never an empty bubble or a banner that loses the text.
    expect(state.activeTurns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(state.activeTurns[0]!.content).toBe("this will fail before any content streams");
    const reply = state.activeTurns[1]!;
    expect(reply.streaming).toBe(false);
    expect(reply.runFailed?.ending).toBe("failed");
    expect(reply.runFailed?.error).toBeTruthy();
    expect(state.sending).toBe(false);
    expect(state.error).toBeNull();
  });

  it("keeps the message the same way when fetch itself throws (network failure), without the error class tag", async () => {
    const fetchImpl: FetchFn = (async (url: string) => {
      if (url.endsWith("/api/chat/sessions")) {
        return new Response(
          JSON.stringify([
            { sessionId: "s1", name: "S1", agentConfig: {}, createdAt: Date.now(), lastUsedAt: Date.now() },
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
        throw new TypeError("Failed to fetch");
      }

      return new Response(JSON.stringify({ error: "unexpected url" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as FetchFn;

    globalThis.fetch = fetchImpl;

    await chatStore.loadSessions();
    await chatStore.selectSession("s1");
    await chatStore.sendMessageStream("this will throw before any content streams");

    const state = get(chatStore);
    expect(state.activeTurns.map((t) => t.content)).toEqual(["this will throw before any content streams", ""]);
    const reply = state.activeTurns[1]!;
    expect(reply.runFailed?.ending).toBe("failed");
    expect(reply.runFailed?.error).toBeTruthy();
    expect(reply.runFailed?.error).not.toMatch(/^[A-Za-z]*Error:/);
    expect(state.sending).toBe(false);
    expect(state.error).toBeNull();
  });

  it("Stop asks the server to stop the turn (so it is stored as stopped by the user), then drops the stream", async () => {
    const calls: string[] = [];
    let release: (() => void) | undefined;
    const fetchImpl: FetchFn = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/chat/sessions")) {
        return new Response(JSON.stringify([{ sessionId: "s1", name: "S1", agentConfig: {}, createdAt: 1, lastUsedAt: 1 }]), { status: 200 });
      }
      if (url.endsWith("/api/chat/sessions/s1")) {
        return new Response(JSON.stringify({ sessionId: "s1", name: "S1", agentConfig: {}, createdAt: 1, lastUsedAt: 1, turns: [] }), { status: 200 });
      }
      if (url.endsWith("/chat/stop")) {
        release?.();
        return new Response(JSON.stringify({ stopped: true }), { status: 200 });
      }
      if (url.endsWith("/chat/stream")) {
        const enc = new TextEncoder();
        return new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(enc.encode(`data: ${JSON.stringify({ _tag: "TextDelta", text: "working" })}\n\n`));
              release = () => {
                c.enqueue(enc.encode(`data: ${JSON.stringify({ _tag: "StreamCancelled", reason: "user", iterationsCompleted: 0 })}\n\n`));
                c.close();
              };
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        );
      }
      return new Response("{}", { status: 404 });
    }) as FetchFn;
    globalThis.fetch = fetchImpl;

    await chatStore.loadSessions();
    await chatStore.selectSession("s1");
    const sending = chatStore.sendMessageStream("long task");
    await new Promise((r) => setTimeout(r, 20));
    await chatStore.stop();
    await sending;

    expect(calls.some((c) => c.startsWith("POST ") && c.endsWith("/api/chat/sessions/s1/chat/stop"))).toBe(true);
    const reply = get(chatStore).activeTurns.at(-1)!;
    expect(reply.cancelled).toBe(true);
    expect(reply.runFailed).toMatchObject({ ending: "interrupted", interruptedBy: "user" });
  });

  it("keeps partial content and surfaces the error when a stream fails mid-stream (after content already arrived)", async () => {
    const fetchImpl: FetchFn = (async (url: string) => {
      if (url.endsWith("/api/chat/sessions")) {
        return new Response(
          JSON.stringify([
            { sessionId: "s1", name: "S1", agentConfig: {}, createdAt: Date.now(), lastUsedAt: Date.now() },
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
        // Some real content arrives, then the connection drops mid-stream
        // (stream ends without a StreamCompleted terminal event, which
        // `connectRunStream` — with no attach/runId to retry against —
        // turns into a synthesized StreamError).
        return sseStreamResponse([
          'data: {"_tag":"TextDelta","text":"Partial answer before drop..."}\n\n',
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
    await chatStore.sendMessageStream("this will drop mid-stream");

    const state = get(chatStore);
    const assistant = [...state.activeTurns].reverse().find((t) => t.role === "assistant");
    // Mid-stream failure: unlike the pre-stream case, the assistant turn is
    // NOT removed — its partial content survives, and the error is surfaced
    // alongside it.
    expect(assistant).toBeDefined();
    expect(assistant?.content).toContain("Partial answer before drop...");
    expect(state.error).toBeTruthy();
  });
});

describe("chatStore history utilities", () => {
  const session = { sessionId: "s1", name: "S1", agentConfig: {}, createdAt: 0, lastUsedAt: 0 };

  it("rewind posts the turn id, then re-syncs turns from the server and returns the removed prompt", async () => {
    const calls: string[] = [];
    let turns = [
      { id: 10, role: "user", content: "q1", tokensUsed: 0, ts: 0 },
      { id: 11, role: "assistant", content: "a1", tokensUsed: 1, ts: 0 },
    ];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/chat/sessions")) return new Response(JSON.stringify([session]));
      if (url.endsWith("/rewind")) {
        turns = [];
        return new Response(JSON.stringify({ removed: 2, userMessage: "q1" }));
      }
      return new Response(JSON.stringify({ ...session, turns }));
    }) as FetchFn;
    await chatStore.selectSession("s1");
    expect(get(chatStore).activeTurns).toHaveLength(2);
    const text = await chatStore.rewind(10);
    expect(text).toBe("q1");
    expect(get(chatStore).activeTurns).toHaveLength(0);
    expect(calls.some((c) => c.startsWith("POST") && c.endsWith("/rewind"))).toBe(true);
  });

  it("fork switches to the new session; server errors surface their message", async () => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/fork")) return new Response(JSON.stringify({ sessionId: "s2" }));
      if (url.endsWith("/clear")) return new Response(JSON.stringify({ error: "session is busy" }), { status: 409 });
      if (url.endsWith("/api/chat/sessions")) return new Response(JSON.stringify([session, { ...session, sessionId: "s2" }]));
      const id = url.includes("/s2") ? "s2" : "s1";
      return new Response(JSON.stringify({ ...session, sessionId: id, turns: [] }));
    }) as FetchFn;
    await chatStore.selectSession("s1");
    expect(await chatStore.fork(11)).toBe("s2");
    expect(get(chatStore).activeSessionId).toBe("s2");
    await expect(chatStore.clearContext()).rejects.toThrow("session is busy");
  });
});

describe("chatStore posture", () => {
  it("sends the per-turn posture override in the stream body", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/chat/sessions")) return json([{ sessionId: "s1", name: "S1", agentConfig: {}, createdAt: Date.now(), lastUsedAt: Date.now() }]);
      if (url.endsWith("/api/chat/sessions/s1")) return json({ sessionId: "s1", name: "S1", agentConfig: {}, createdAt: Date.now(), lastUsedAt: Date.now(), turns: [] });
      if (url.endsWith("/chat/stream")) {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return sseStreamResponse(['data: {"_tag":"StreamCompleted","output":"ok","metadata":{"tokensUsed":1,"iterations":1}}\n\n']);
      }
      return json({});
    }) as FetchFn;
    await chatStore.loadSessions();
    await chatStore.selectSession("s1");
    await chatStore.sendMessageStream("plan it", { posture: "plan" });
    expect(bodies[0]).toEqual({ message: "plan it", posture: "plan" });
    await chatStore.sendMessageStream("do it", { posture: "execute" });
    expect(bodies[1]).toEqual({ message: "do it", posture: "execute" });
    await chatStore.sendMessageStream("plain");
    expect(bodies[2]).toEqual({ message: "plain" });
  });
});

describe("chatStore.refreshActive", () => {
  it("coalesces concurrent calls into one in-flight session read (fetch-storm guard)", async () => {
    const session = { sessionId: "s1", name: "S1", agentConfig: {}, createdAt: 0, lastUsedAt: 0 };
    let sessionReads = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/api/chat/sessions/s1") && sessionReads++ > 0) await gate;
      return new Response(JSON.stringify({ ...session, turns: [] }));
    }) as FetchFn;
    await chatStore.selectSession("s1");
    sessionReads = 1;
    const calls = Promise.all([chatStore.refreshActive(), chatStore.refreshActive(), chatStore.refreshActive()]);
    release();
    await calls;
    expect(sessionReads).toBe(2);
    await chatStore.refreshActive();
    expect(sessionReads).toBe(3);
  });
});

describe("chatStore — a turn that pauses for durable approval", () => {
  it("drops the streamed 'paused' text and adopts the server's pending approval instead", async () => {
    const pending = { runId: "r1", sessionId: "s9", userMessage: "write it", gateId: "g1", toolName: "file-write", args: { path: "/w/a" }, createdAt: 1 };
    let paused = false;
    globalThis.fetch = (async (url: string) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/api/chat/sessions")) return json([{ sessionId: "s9", name: "S9", agentConfig: {}, createdAt: 1, lastUsedAt: 1 }]);
      if (url.endsWith("/api/chat/sessions/s9")) {
        return json({ sessionId: "s9", name: "S9", agentConfig: {}, createdAt: 1, lastUsedAt: 1, turns: [], pendingApprovals: paused ? [pending] : [] });
      }
      if (url.endsWith("/api/chat/sessions/s9/chat/stream")) {
        paused = true;
        return sseStreamResponse([
          'data: {"_tag":"StreamCompleted","output":"Run paused — awaiting human approval.","metadata":{"tokensUsed":3},"status":"awaiting-approval","pendingApproval":{"runId":"r1","gateId":"g1","toolName":"file-write","args":{"path":"/w/a"}}}\n\n',
        ]);
      }
      return new Response("{}", { status: 500 });
    }) as FetchFn;

    await chatStore.loadSessions();
    await chatStore.selectSession("s9");
    await chatStore.sendMessageStream("write it");

    const state = get(chatStore);
    expect(state.activeTurns).toEqual([]);
    expect(state.activePendingApprovals).toEqual([pending]);
  });

  it("a turn that pauses on request_user_input adopts the server's pending question instead of the 'paused' text", async () => {
    const pending = { runId: "r2", sessionId: "s8", userMessage: "paint it", interactionId: "i1", kind: "choice", prompt: "Which colour?", schema: { options: ["red"] }, createdAt: 1 };
    let paused = false;
    globalThis.fetch = (async (url: string) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/api/chat/sessions")) return json([{ sessionId: "s8", name: "S8", agentConfig: {}, createdAt: 1, lastUsedAt: 1 }]);
      if (url.endsWith("/api/chat/sessions/s8")) {
        return json({ sessionId: "s8", name: "S8", agentConfig: {}, createdAt: 1, lastUsedAt: 1, turns: [], pendingApprovals: [], pendingInteractions: paused ? [pending] : [] });
      }
      if (url.endsWith("/api/chat/sessions/s8/chat/stream")) {
        paused = true;
        return sseStreamResponse([
          'data: {"_tag":"StreamCompleted","output":"Run paused — awaiting human input.","metadata":{"tokensUsed":3},"pendingInteraction":{"runId":"r2","interactionId":"i1","kind":"choice","prompt":"Which colour?","schema":{"options":["red"]}}}\n\n',
        ]);
      }
      return new Response("{}", { status: 500 });
    }) as FetchFn;

    await chatStore.loadSessions();
    await chatStore.selectSession("s8");
    await chatStore.sendMessageStream("paint it");

    const state = get(chatStore);
    expect(state.activeTurns).toEqual([]);
    expect(state.activePendingInteractions).toEqual([pending]);
  });
});

describe("chatStore history-change listeners", () => {
  it("tells listeners after clear, compact and rewind succeed, and not when the request fails", async () => {
    let fail = false;
    globalThis.fetch = (async (url: string) => {
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/api/chat/sessions")) return json([{ sessionId: "s9", name: "S9", agentConfig: {}, createdAt: 1, lastUsedAt: 1 }]);
      if (url.endsWith("/api/chat/sessions/s9")) return json({ sessionId: "s9", name: "S9", agentConfig: {}, createdAt: 1, lastUsedAt: 1, turns: [], pendingApprovals: [], pendingInteractions: [] });
      if (url.endsWith("/clear") || url.endsWith("/compact") || url.endsWith("/rewind")) return fail ? json({ error: "busy" }, 409) : json({ removed: 1, compacted: 1, userMessage: "" });
      return json({}, 500);
    }) as FetchFn;
    await chatStore.loadSessions();
    await chatStore.selectSession("s9");
    const seen: string[] = [];
    const off = chatStore.onHistoryChange((sid) => void seen.push(sid));
    await chatStore.clearContext();
    await chatStore.compact();
    await chatStore.rewind(3);
    expect(seen).toEqual(["s9", "s9", "s9"]);
    fail = true;
    await chatStore.clearContext().catch(() => {});
    expect(seen).toHaveLength(3);
    off();
    fail = false;
    await chatStore.clearContext();
    expect(seen).toHaveLength(3);
  });
});
