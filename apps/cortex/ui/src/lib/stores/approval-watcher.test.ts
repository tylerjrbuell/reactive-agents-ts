import { describe, expect, test } from "bun:test";
import { approvalToastMessage } from "./approval-watcher.js";

describe("approvalToastMessage", () => {
  // 2026-11-11 QA: the toast ended in "· 01M75CRYN1ZHG17DZ5", a chat agent's bare ULID.
  test("names the call and where it came from, never the agent id", () => {
    expect(approvalToastMessage({ toolName: "crypto-price", args: { coins: ["ethereum"] }, chatSessionId: "s1" })).toBe(
      'crypto-price({"coins":["ethereum"]}) · from a chat',
    );
    expect(approvalToastMessage({ toolName: "file-write", args: { path: "a.md" } })).toBe('file-write({"path":"a.md"}) · from a desk run');
  });

  test("a sub-agent's request names who is asking", () => {
    expect(approvalToastMessage({ toolName: "file-write", args: { path: "a.md" }, subAgent: "researcher", chatSessionId: "s1" })).toBe(
      'researcher wants file-write({"path":"a.md"}) · from a chat',
    );
  });

  test("long arguments are cut", () => {
    const msg = approvalToastMessage({ toolName: "web-search", args: { query: "x".repeat(200) } });
    expect(msg.length).toBeLessThan(120);
    expect(msg).toContain("…");
  });
});
