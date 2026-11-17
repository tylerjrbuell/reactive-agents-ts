import { describe, expect, test } from "bun:test";
import { approvalArgRows, approvalArgsNeedDetail, approvalFullArgs, decideChatApproval, MAX_FULL_ARG_CHARS, startChatApproval } from "./chat-approvals.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("approvalArgRows", () => {
  test("one row per top-level arg; long or multi-line values collapse to one clipped line", () => {
    const rows = approvalArgRows({ path: "/w/a.txt", content: `line1\nline2 ${"x".repeat(300)}` });
    expect(rows[0]).toEqual({ key: "path", value: "/w/a.txt" });
    expect(rows[1]!.key).toBe("content");
    expect(rows[1]!.value.startsWith("line1 line2 ")).toBe(true);
    expect(rows[1]!.value.endsWith("…")).toBe(true);
    expect(rows[1]!.value.length).toBe(161);
  });

  test("non-object args become a single row; nothing for null", () => {
    expect(approvalArgRows("ls -la")).toEqual([{ key: "args", value: "ls -la" }]);
    expect(approvalArgRows([1, 2])).toEqual([{ key: "args", value: "[1,2]" }]);
    expect(approvalArgRows(null)).toEqual([]);
    expect(approvalArgRows({ n: 3, o: { a: 1 } })).toEqual([{ key: "n", value: "3" }, { key: "o", value: '{"a":1}' }]);
  });
});

describe("decideChatApproval", () => {
  test("posts to the session-scoped route and reads completed vs re-paused", async () => {
    const seen: { url: string; body: string }[] = [];
    const f = async (url: string, init?: RequestInit) => {
      seen.push({ url, body: String(init?.body) });
      return json(url.includes("r2") ? { ok: true, status: "awaiting-approval" } : { ok: true, status: "completed", reply: "done" });
    };
    expect(await decideChatApproval("s 1", "r1", "approve", undefined, f)).toEqual({ ok: true, status: "completed" });
    expect(await decideChatApproval("s1", "r2", "approve", undefined, f)).toEqual({ ok: true, status: "awaiting-approval" });
    expect(seen[0]!.url).toContain("/api/chat/sessions/s%201/approvals/r1/approve");
    expect(seen[0]!.body).toBe("{}");
  });

  test("deny forwards a trimmed reason; dismiss reports dismissed", async () => {
    const bodies: string[] = [];
    const f = async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return json({ ok: true });
    };
    expect(await decideChatApproval("s", "r", "deny", "  not that file ", f)).toEqual({ ok: true, status: "completed" });
    expect(bodies[0]).toBe(JSON.stringify({ reason: "not that file" }));
    expect(await decideChatApproval("s", "r", "dismiss", undefined, f)).toEqual({ ok: true, status: "dismissed" });
  });

  test("server and network failures come back as values, not throws", async () => {
    expect(await decideChatApproval("s", "r", "approve", undefined, async () => json({ error: "config changed" }, 422))).toEqual({
      ok: false,
      status: 422,
      error: "config changed",
    });
    const down = await decideChatApproval("s", "r", "approve", undefined, async () => {
      throw new Error("offline");
    });
    expect(down).toEqual({ ok: false, status: 0, error: "offline" });
  });
});

describe("approvalFullArgs / approvalArgsNeedDetail", () => {
  test("the full text keeps what a row clips, pretty-printed, with secrets masked", () => {
    const body = `a\nb ${"x".repeat(300)}`;
    const full = approvalFullArgs({ command: "which gh; gh --version", content: body, header: "Authorization: Bearer sk-abcdefghijklmnop12345" });
    expect(full).toContain('"command": "which gh; gh --version"');
    expect(full).toContain("x".repeat(300));
    expect(full).not.toContain("sk-abcdefghijklmnop12345");
    expect(approvalFullArgs("ls -la")).toBe("ls -la");
    expect(approvalFullArgs(null)).toBe("");
  });

  test("a huge value is cut with a note, not sent whole", () => {
    const full = approvalFullArgs({ content: "y".repeat(MAX_FULL_ARG_CHARS * 2) });
    expect(full.length).toBeLessThan(MAX_FULL_ARG_CHARS + 100);
    expect(full).toContain("cut at");
  });

  test("detail is offered only when a row loses something", () => {
    expect(approvalArgsNeedDetail({ command: "which gh; gh --version" })).toBe(false);
    expect(approvalArgsNeedDetail("ls")).toBe(false);
    expect(approvalArgsNeedDetail(null)).toBe(false);
    expect(approvalArgsNeedDetail({ content: "x".repeat(200) })).toBe(true);
    expect(approvalArgsNeedDetail({ content: "a\nb" })).toBe(true);
    expect(approvalArgsNeedDetail({ opts: { a: 1 } })).toBe(true);
  });
});

describe("startChatApproval", () => {
  test("posts to the /start route and answers on the immediate reply", async () => {
    const seen: { url: string; body: string }[] = [];
    const f = async (url: string, init?: RequestInit) => {
      seen.push({ url, body: String(init?.body) });
      return json({ started: true, message: "m" });
    };
    expect(await startChatApproval("s 1", "r1", "approve", undefined, f)).toEqual({ ok: true });
    expect(await startChatApproval("s", "r", "deny", "  no ", f)).toEqual({ ok: true });
    expect(seen[0]!.url).toContain("/api/chat/sessions/s%201/approvals/r1/approve/start");
    expect(seen[1]!.url).toContain("/approvals/r/deny/start");
    expect(seen[1]!.body).toBe(JSON.stringify({ reason: "no" }));
  });

  test("a refusal or a network failure comes back as a value", async () => {
    expect(await startChatApproval("s", "r", "approve", undefined, async () => json({ error: "A turn is running" }, 409))).toEqual({ ok: false, status: 409, error: "A turn is running" });
    expect(await startChatApproval("s", "r", "approve", undefined, async () => { throw new Error("offline"); })).toEqual({ ok: false, status: 0, error: "offline" });
  });
});
