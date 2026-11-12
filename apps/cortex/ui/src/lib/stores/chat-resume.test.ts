import { afterEach, describe, expect, it } from "bun:test";
import { get } from "svelte/store";
import { chatStore } from "./chat-store.js";
import { fetchActiveTurn, resumedTurns, shouldResume } from "./chat-resume.js";
import type { ChatTurn } from "./chat-store.js";

type FetchFn = typeof fetch;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sse = (frames: string[]): Response => {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const f of frames) c.enqueue(enc.encode(f));
        c.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
};

describe("fetchActiveTurn", () => {
  it("returns the running turn's message and start; nothing for an idle session, an error, or a network failure", async () => {
    const ok = (async () => json({ active: true, message: "ask me", startedAt: 5 })) as unknown as FetchFn;
    expect(await fetchActiveTurn("s1", ok)).toEqual({ message: "ask me", startedAt: 5 });
    expect(await fetchActiveTurn("s1", (async () => json({ active: false })) as unknown as FetchFn)).toBeUndefined();
    expect(await fetchActiveTurn("s1", (async () => json({}, 500)) as unknown as FetchFn)).toBeUndefined();
    expect(await fetchActiveTurn("s1", (async () => { throw new Error("down"); }) as unknown as FetchFn)).toBeUndefined();
  });
});

describe("resume rules", () => {
  const turn = (over: Partial<ChatTurn>): ChatTurn => ({ id: 1, role: "assistant", content: "", tokensUsed: 0, ts: 0, ...over });
  it("draws the user's message and a streaming assistant turn", () => {
    const { user, assistant } = resumedTurns({ message: "m", startedAt: 9 }, 100, { provider: "test" });
    expect(user).toMatchObject({ role: "user", content: "m", ts: 9, id: 100 });
    expect(assistant).toMatchObject({ role: "assistant", streaming: true, provider: "test", id: 101 });
  });
  it("resumes only a running turn the page is not already streaming", () => {
    const info = { message: "m", startedAt: 1 };
    expect(shouldResume(info, { sending: false, turns: [] })).toBe(true);
    expect(shouldResume(undefined, { sending: false, turns: [] })).toBe(false);
    expect(shouldResume(info, { sending: true, turns: [] })).toBe(false);
    expect(shouldResume(info, { sending: false, turns: [turn({ streaming: true })] })).toBe(false);
  });
});

describe("chatStore: a turn that kept running while the page was away", () => {
  it("opening the session attaches to the running turn, brings back its pending card, and finishes it", async () => {
    const attachUrls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/api/chat/sessions")) return json([{ sessionId: "s1", name: "S1", agentConfig: {}, createdAt: 1, lastUsedAt: 1 }]);
      if (url.endsWith("/api/chat/sessions/s1")) return json({ sessionId: "s1", name: "S1", agentConfig: {}, createdAt: 1, lastUsedAt: 1, turns: [] });
      if (url.endsWith("/chat/active")) return json({ active: true, message: "write the file", startedAt: 7 });
      if (url.includes("/chat/stream/active")) {
        attachUrls.push(url);
        return sse([
          'id: 0\ndata: {"_tag":"ApprovalRequested","runId":"r1","gateId":"g1","toolName":"file-write","args":{"path":"a"},"subAgent":"alpha"}\n\n',
          'id: 1\ndata: {"_tag":"StreamCompleted","output":"wrote it","metadata":{"tokensUsed":3}}\n\n',
        ]);
      }
      return json({ error: "unexpected url" }, 500);
    }) as unknown as FetchFn;

    await chatStore.loadSessions();
    await chatStore.selectSession("s1");
    // Let the attached stream run to its end.
    for (let i = 0; i < 100 && (attachUrls.length === 0 || get(chatStore).sending); i++) await new Promise((r) => setTimeout(r, 10));

    expect(attachUrls).toHaveLength(1);
    expect(attachUrls[0]).toMatch(/\/chat\/stream\/active$/);
    const turns = get(chatStore).activeTurns;
    expect(turns[0]).toMatchObject({ role: "user", content: "write the file" });
    const assistant = turns.find((t) => t.role === "assistant");
    expect(assistant?.content).toBe("wrote it");
    expect(assistant?.streaming).toBe(false);
  });

  it("a server-started turn (goal segment) that begins after the session opened is attached on the poll tick, then replaced by the stored turn", async () => {
    let running = false;
    let stored = false;
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/api/chat/sessions")) return json([{ sessionId: "s3", name: "S3", agentConfig: {}, createdAt: 1, lastUsedAt: 1 }]);
      if (url.endsWith("/api/chat/sessions/s3")) {
        const turns = stored
          ? [
              { id: 1, role: "user", content: "segment prompt", tokensUsed: 0, ts: 1 },
              { id: 2, role: "assistant", content: "done it", tokensUsed: 3, ts: 2 },
            ]
          : [];
        return json({ sessionId: "s3", name: "S3", agentConfig: {}, createdAt: 1, lastUsedAt: 1, turns });
      }
      if (url.endsWith("/chat/active")) return json(running ? { active: true, message: "segment prompt", startedAt: 7 } : { active: false });
      if (url.includes("/chat/stream/active")) {
        stored = true;
        return sse(['id: 0\ndata: {"_tag":"TextDelta","text":"done it"}\n\n', 'id: 1\ndata: {"_tag":"StreamCompleted","output":"done it","metadata":{"tokensUsed":3}}\n\n']);
      }
      return json({ error: "unexpected url" }, 500);
    }) as unknown as FetchFn;
    await chatStore.loadSessions();
    await chatStore.selectSession("s3");
    await new Promise((r) => setTimeout(r, 20));
    expect(get(chatStore).activeTurns).toEqual([]);

    running = true;
    expect(await chatStore.resumeActiveTurn("s3")).toBe(true);
    for (let i = 0; i < 100 && get(chatStore).sending; i++) await new Promise((r) => setTimeout(r, 10));
    const turns = get(chatStore).activeTurns;
    // One user and one assistant bubble: the live pair was replaced by the stored one, not duplicated.
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(turns[1]?.content).toBe("done it");
  });

  it("nothing running: the session opens as before, with no attach", async () => {
    let attached = false;
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/api/chat/sessions")) return json([{ sessionId: "s2", name: "S2", agentConfig: {}, createdAt: 1, lastUsedAt: 1 }]);
      if (url.endsWith("/api/chat/sessions/s2")) return json({ sessionId: "s2", name: "S2", agentConfig: {}, createdAt: 1, lastUsedAt: 1, turns: [] });
      if (url.endsWith("/chat/active")) return json({ active: false });
      if (url.includes("/chat/stream")) attached = true;
      return json({ error: "unexpected url" }, 500);
    }) as unknown as FetchFn;
    await chatStore.loadSessions();
    await chatStore.selectSession("s2");
    await new Promise((r) => setTimeout(r, 20));
    expect(attached).toBe(false);
    expect(get(chatStore).activeTurns).toEqual([]);
  });
});
