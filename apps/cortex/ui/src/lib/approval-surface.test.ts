import { describe, expect, test } from "bun:test";
import { OTHER_VIEW, approvalOnScreen, showToast } from "./approval-surface.js";
import type { PendingApprovalWire } from "./waiting-on-you.js";

const chatApproval: PendingApprovalWire = { runId: "r-chat", agentId: "a-chat", gateId: "g", toolName: "file-read", args: { path: "x" }, chatSessionId: "s1" };
const deskApproval: PendingApprovalWire = { runId: "durable-9", agentId: "desk-agent", gateId: "g", toolName: "shell-execute", args: {} };

describe("showToast", () => {
  test("a chat approval: no toast while its chat is open; a toast in another chat or elsewhere", () => {
    expect(showToast(chatApproval, { kind: "chat", sessionId: "s1" })).toBe(false);
    expect(showToast(chatApproval, { kind: "chat", sessionId: "s2" })).toBe(true);
    expect(showToast(chatApproval, OTHER_VIEW)).toBe(true);
  });

  test("a chat approval: no toast on the run view of that chat's run (by id or by session)", () => {
    expect(showToast(chatApproval, { kind: "run", runId: "r-chat", agentId: "a-chat" })).toBe(false);
    expect(showToast(chatApproval, { kind: "run", runId: "other-run", agentId: "a-chat", chatSessionId: "s1" })).toBe(false);
    expect(showToast(chatApproval, { kind: "run", runId: "other-run", agentId: "a-chat", chatSessionId: "s2" })).toBe(true);
  });

  test("a desk approval (durable run id): no toast on its agent's run view, a toast on another run's", () => {
    expect(showToast(deskApproval, { kind: "run", runId: "cortex-run-1", agentId: "desk-agent" })).toBe(false);
    expect(showToast(deskApproval, { kind: "run", runId: "cortex-run-2", agentId: "someone-else" })).toBe(true);
    expect(showToast(deskApproval, { kind: "chat", sessionId: "s1" })).toBe(true);
    expect(approvalOnScreen(deskApproval, OTHER_VIEW)).toBe(false);
  });
});
