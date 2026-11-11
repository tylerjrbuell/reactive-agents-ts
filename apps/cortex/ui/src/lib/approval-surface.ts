/**
 * One approval surface at a time. A pending approval shows inline where its run
 * or chat is on screen (the chat's approval card, the run view header); the
 * app-wide "Approval needed" toast is only for approvals whose run or chat is NOT
 * on screen (another route, another chat session, the run view of another run).
 * Pure.
 */
import { waitingRunsOf, type PendingApprovalWire } from "./waiting-on-you.js";

/** What the user is looking at, as far as approvals care. */
export type ApprovalView =
  | { readonly kind: "chat"; readonly sessionId: string }
  | { readonly kind: "run"; readonly runId: string; readonly agentId: string; readonly chatSessionId?: string }
  | { readonly kind: "other" };

/** Nothing that shows approvals inline is on screen. */
export const OTHER_VIEW: ApprovalView = { kind: "other" };

/**
 * True when `approval` already has an inline surface in `view`: the open chat is
 * the approval's chat session, or the run view would show it in its header (the
 * same match the run view uses, `waitingRunsOf`: the run id, else a chat
 * approval's session, else a desk approval's agent).
 */
export function approvalOnScreen(approval: PendingApprovalWire, view: ApprovalView): boolean {
  if (view.kind === "chat") return approval.chatSessionId !== undefined && approval.chatSessionId === view.sessionId;
  if (view.kind === "run") {
    const run = {
      runId: view.runId,
      agentId: view.agentId,
      startedAt: 0,
      ...(view.chatSessionId !== undefined ? { chatSessionId: view.chatSessionId } : {}),
    };
    return waitingRunsOf([run], [approval], []).has(view.runId);
  }
  return false;
}

/** True when the app-wide toast should show `approval` in `view` (it is not on screen). */
export function showToast(approval: PendingApprovalWire, view: ApprovalView): boolean {
  return !approvalOnScreen(approval, view);
}
