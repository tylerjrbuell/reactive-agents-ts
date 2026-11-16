import { afterEach, describe, expect, it } from "bun:test";
import { get } from "svelte/store";
import { chatStore } from "./chat-store.js";
import { chatMode, executePlan, setChatMode } from "./chat-mode-store.js";

type FetchFn = typeof fetch;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const row = (id: string, mode?: "plan" | "execute") => ({ sessionId: id, name: id, agentConfig: {}, createdAt: 0, lastUsedAt: 0, ...(mode ? { mode } : {}) });

/** Serve the session list (with `mode`), the session read, the mode PUT and the stream. */
function server(sessions: ReturnType<typeof row>[], on: { put?: (b: Record<string, unknown>) => Response; stream?: (b: Record<string, unknown>) => void } = {}): void {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/mode")) return on.put ? on.put(JSON.parse(String(init?.body)) as Record<string, unknown>) : json({ mode: "execute" });
    if (url.endsWith("/chat/stream")) {
      on.stream?.(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response('data: {"_tag":"StreamCompleted","output":"ok","metadata":{"tokensUsed":1,"iterations":1}}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    }
    if (url.endsWith("/api/chat/sessions")) return json(sessions);
    const id = decodeURIComponent(url.split("/sessions/")[1]!.split("/")[0]!);
    return json({ ...sessions.find((s) => s.sessionId === id)!, turns: [] });
  }) as FetchFn;
}

describe("chat session mode store", () => {
  it("reads the stored mode from the session list; setChatMode PUTs it and holds", async () => {
    const puts: Array<Record<string, unknown>> = [];
    server([row("m1", "plan")], { put: (b) => (puts.push(b), json({ mode: b.mode })) });
    await chatStore.loadSessions();
    await chatStore.selectSession("m1");
    expect(get(chatMode)).toBe("plan");
    expect(await setChatMode("execute")).toBe(true);
    expect(get(chatMode)).toBe("execute");
    expect(puts).toEqual([{ mode: "execute" }]);
  });

  it("a session without a stored mode is execute", async () => {
    server([row("m2")]);
    await chatStore.loadSessions();
    await chatStore.selectSession("m2");
    expect(get(chatMode)).toBe("execute");
  });

  it("reverts when the server refuses", async () => {
    server([row("m3", "execute")], { put: () => json({ error: "nope" }, 500) });
    await chatStore.loadSessions();
    await chatStore.selectSession("m3");
    expect(await setChatMode("plan")).toBe(false);
    expect(get(chatMode)).toBe("execute");
  });

  it("executePlan switches to execute, then sends 'Execute the plan.' with no per-turn posture", async () => {
    const calls: string[] = [];
    let body: Record<string, unknown> | undefined;
    server([row("m4", "plan")], { put: (b) => (calls.push("mode"), json({ mode: b.mode })), stream: (b) => (calls.push("stream"), (body = b)) });
    await chatStore.loadSessions();
    await chatStore.selectSession("m4");
    await executePlan();
    expect(calls).toEqual(["mode", "stream"]);
    expect(body).toEqual({ message: "Execute the plan." });
    expect(get(chatMode)).toBe("execute");
  });
});
