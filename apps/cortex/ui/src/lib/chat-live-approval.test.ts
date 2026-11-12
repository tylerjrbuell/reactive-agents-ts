import { describe, expect, test } from "bun:test";
import { approvalCardKey, decideLiveApproval, liveApprovalAfter, orphanChatApprovals, type LiveApproval } from "./chat-live-approval.js";

const asked: LiveApproval = { runId: "r1", gateId: "g1", toolName: "shell-execute", args: { command: "git push" } };

describe("liveApprovalAfter", () => {
  test("ApprovalRequested sets the wait from the event", () => {
    expect(
      liveApprovalAfter(undefined, { _tag: "ApprovalRequested", runId: "r1", gateId: "g1", toolName: "shell-execute", args: { command: "git push" } }),
    ).toEqual(asked);
  });

  test("the run moving on clears it; unrelated events keep the same reference", () => {
    expect(liveApprovalAfter(asked, { _tag: "ToolCallCompleted", toolName: "shell-execute", callId: "c", durationMs: 1, success: true })).toBeUndefined();
    expect(liveApprovalAfter(asked, { _tag: "StreamCancelled", reason: "stop", iterationsCompleted: 1 })).toBeUndefined();
    expect(liveApprovalAfter(asked, { _tag: "TextDelta", text: "ok" })).toBeUndefined();
    expect(liveApprovalAfter(asked, { _tag: "TokenUsage", tokensTotal: 5, costUsd: 0 } as never)).toBe(asked);
    expect(liveApprovalAfter(undefined, { _tag: "TextDelta", text: "ok" })).toBeUndefined();
  });
});

describe("orphanChatApprovals", () => {
  const p = (runId: string, chatSessionId?: string) => ({ runId, agentId: "a", gateId: "g", toolName: "file-read", args: { path: "x" }, ...(chatSessionId ? { chatSessionId } : {}) });
  test("lists this chat's live waits that no card shows yet; skips durable, streaming, hidden and other chats", () => {
    const pending = [p("live", "s1"), p("durable", "s1"), p("streaming", "s1"), p("hidden", "s1"), p("other", "s2"), p("desk")];
    const out = orphanChatApprovals("s1", pending, new Set(["durable"]), new Set([approvalCardKey({ runId: "streaming", gateId: "g" })]), new Set([approvalCardKey({ runId: "hidden", gateId: "g" })]));
    expect(out).toEqual([{ runId: "live", gateId: "g", toolName: "file-read", args: { path: "x" } }]);
  });

  test("parallel sub-agents share a run id: the streaming card hides only its own gate, the other gate stays, with its sub-agent", () => {
    const pending = [
      { runId: "root", agentId: "a", gateId: "gate-a", toolName: "risky", args: {}, chatSessionId: "s1", subAgent: "alpha" },
      { runId: "root", agentId: "a", gateId: "gate-b", toolName: "risky", args: {}, chatSessionId: "s1", subAgent: "beta" },
    ];
    const out = orphanChatApprovals("s1", pending, new Set(), new Set([approvalCardKey({ runId: "root", gateId: "gate-b" })]), new Set());
    expect(out).toEqual([{ runId: "root", gateId: "gate-a", toolName: "risky", args: {}, subAgent: "alpha" }]);
  });
});

describe("approval by gate", () => {
  test("ApprovalRequested carries the sub-agent that asks", () => {
    const got = liveApprovalAfter(undefined, { _tag: "ApprovalRequested", runId: "root", gateId: "g2", toolName: "risky", args: {}, subAgent: "beta" });
    expect(got).toEqual({ runId: "root", gateId: "g2", toolName: "risky", args: {}, subAgent: "beta" });
  });

  test("decideLiveApproval sends the gate so only that request is answered", async () => {
    const bodies: unknown[] = [];
    const fetchFn = (async (_url: unknown, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? "{}"));
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    await decideLiveApproval("root", "approve", undefined, fetchFn, "gate-b");
    await decideLiveApproval("root", "deny", "no", fetchFn, "gate-a");
    expect(bodies).toEqual([{ gateId: "gate-b" }, { reason: "no", gateId: "gate-a" }]);
  });
});

describe("decideLiveApproval", () => {
  test("posts approve / deny (with a reason) to the shared approval routes", async () => {
    const seen: { url: string; body: string }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seen.push({ url, body: String(init?.body) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await decideLiveApproval("r 1", "approve", undefined, fetchFn)).toEqual({ ok: true });
    expect(await decideLiveApproval("r1", "deny", "  not that branch ", fetchFn)).toEqual({ ok: true });
    expect(seen[0]!.url.endsWith("/api/runs/r%201/approve")).toBe(true);
    expect(seen[1]!.url.endsWith("/api/runs/r1/deny")).toBe(true);
    expect(JSON.parse(seen[1]!.body)).toEqual({ reason: "not that branch" });
  });

  test("a server error is reported, not thrown", async () => {
    const fetchFn = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await decideLiveApproval("r1", "approve", undefined, fetchFn)).toEqual({ ok: false, error: "Server returned 500" });
  });
});
