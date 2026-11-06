import { describe, expect, test } from "bun:test";
import { approvalArgRows, decideChatApproval } from "./chat-approvals.js";

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
