import { describe, expect, test } from "bun:test";
import { askBtw, asideTitle, btwContextOf, settleAside, type BtwAside } from "./chat-btw.js";
import type { ChatTurn } from "./stores/chat-store.js";

const turn = (over: Partial<ChatTurn> & Pick<ChatTurn, "role" | "content">): ChatTurn => ({ id: 1, tokensUsed: 0, ts: 0, ...over });

describe("btwContextOf", () => {
  test("a streaming turn: its task, the calls so far and the text streamed so far", () => {
    const ctx = btwContextOf([
      turn({ id: 1, role: "user", content: "find big files" }),
      turn({
        id: 2,
        role: "assistant",
        content: "",
        streaming: true,
        liveText: "I found two",
        toolCalls: [
          { id: "a", name: "shell-execute", status: "done", args: { command: "du -a" }, result: "10 a.txt" },
          { id: "b", name: "file-read", status: "failed", error: "ENOENT" },
          { id: "c", name: "web-search", status: "running" },
        ],
      }),
    ]);
    expect(ctx).toEqual({
      task: "find big files",
      running: true,
      draft: "I found two",
      steps: [
        { tool: "shell-execute", args: '{\n  "command": "du -a"\n}', result: "10 a.txt" },
        { tool: "file-read", result: "ENOENT", failed: true },
        { tool: "web-search" },
      ],
    });
  });

  test("a settled turn is not running and uses its final content", () => {
    const ctx = btwContextOf([turn({ role: "user", content: "q" }), turn({ id: 2, role: "assistant", content: "done", liveText: "stale" })]);
    expect(ctx).toMatchObject({ running: false, draft: "done" });
  });

  test("credential-shaped values never leave the browser", () => {
    const ctx = btwContextOf([
      turn({ role: "user", content: "use key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" }),
      turn({ id: 2, role: "assistant", content: "", streaming: true, toolCalls: [{ id: "a", name: "http-get", status: "done", args: { headers: { Authorization: "Bearer abcdefghijklmnop1234" } }, result: "ok" }] }),
    ]);
    expect(JSON.stringify(ctx)).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(JSON.stringify(ctx)).not.toContain("abcdefghijklmnop1234");
  });

  test("an empty chat has no context", () => {
    expect(btwContextOf([])).toBeNull();
  });
});

describe("aside helpers", () => {
  const pending: BtwAside = { id: 1, question: "why?", whileRunning: true, status: "pending" };

  test("title says when it was asked", () => {
    expect(asideTitle(pending)).toBe("Side question while it ran: why?");
    expect(asideTitle({ ...pending, whileRunning: false })).toBe("Side question: why?");
  });

  test("settle keeps the question and records the answer or the error", () => {
    expect(settleAside(pending, { answer: "Because." })).toMatchObject({ status: "answered", answer: "Because.", question: "why?" });
    expect(settleAside(pending, { error: "down" })).toMatchObject({ status: "failed", error: "down" });
  });
});

describe("askBtw", () => {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  test("posts the question and the snapshot, and returns the answer", async () => {
    let seen: { url: string; body: unknown } | undefined;
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), body: JSON.parse(String(init?.body)) };
      return reply(200, { answer: "Two.", running: true });
    }) as typeof fetch;
    const ctx = { task: "t", running: true, draft: "", steps: [] };
    expect(await askBtw("s 1", "how many?", ctx, fetchFn)).toEqual({ answer: "Two." });
    expect(seen?.url).toContain("/api/chat/sessions/s%201/btw");
    expect(seen?.body).toEqual({ question: "how many?", context: ctx });
  });

  test("a refusal or a network error comes back as an error, not a throw", async () => {
    const asFetch = (fn: () => Promise<Response>): typeof fetch => Object.assign(fn, { preconnect: () => {} });
    expect(await askBtw("s", "q", null, asFetch(async () => reply(400, { error: "nothing to ask about" })))).toEqual({ error: "nothing to ask about" });
    expect(await askBtw("s", "q", null, asFetch(async () => { throw new Error("offline"); }))).toEqual({ error: "offline" });
  });
});
