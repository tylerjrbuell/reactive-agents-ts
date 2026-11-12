/**
 * approval-watcher.ts — app-wide approval prompts (durable pauses and live waits).
 *
 * Polls `/api/runs/pending-approvals` into `pendingApprovals` and raises an
 * interactive toast (Approve / Deny) for a pending approval only while its run or
 * chat is NOT on screen (`showToast`, `lib/approval-surface.ts`): the open chat
 * and the run view show it inline instead. Pages report what is on screen with
 * {@link setApprovalView}; opening the approval's chat or run removes its toast.
 * Answering from any surface calls {@link clearApproval}, which drops it from the
 * shared store and removes its toast at once; a toast also clears when its
 * approval stops being pending.
 */
import { get, writable } from "svelte/store";
import { toast } from "./toast-store.js";
import { CORTEX_SERVER_URL } from "../constants.js";
import { redactSecrets } from "../run-error.js";
import type { PendingApprovalWire } from "../waiting-on-you.js";
import { OTHER_VIEW, showToast, type ApprovalView } from "../approval-surface.js";

type Pending = PendingApprovalWire;

/** The approvals pending at the last poll (Beacon's "Needs you"), updated by the watcher. */
export const pendingApprovals = writable<readonly PendingApprovalWire[]>([]);

/** What is on screen, as far as approvals care (set by the chat page and the run view). */
export const approvalView = writable<ApprovalView>(OTHER_VIEW);

/**
 * Report that `view` is on screen. Returns the release: it resets the view only
 * if it is still this one, so a page unmounting after the next page mounted does
 * not wipe the new page's view. Use as `$effect(() => setApprovalView(view))`.
 */
export function setApprovalView(view: ApprovalView): () => void {
  approvalView.set(view);
  return () => {
    if (get(approvalView) === view) approvalView.set(OTHER_VIEW);
  };
}

const keyFor = (p: Pick<Pending, "runId" | "gateId">) => `approval:${p.runId}|${p.gateId}`;

/** Toast keys currently shown by the watcher. */
const shown = new Set<string>();

/**
 * An approval was answered (from a toast, a chat card or the run header): drop it
 * from the shared store and remove its toast now, without waiting for the next poll.
 */
export function clearApproval(runId: string, gateId?: string): void {
  // With a `gateId` only that request goes: parallel sub-agents share the run id and the
  // others are still waiting. Without one, every gate of the run (the run was answered whole).
  pendingApprovals.update((list) => list.filter((a) => a.runId !== runId || (gateId !== undefined && a.gateId !== gateId)));
  for (const key of [...shown]) {
    if (gateId !== undefined ? key === `approval:${runId}|${gateId}` : key.startsWith(`approval:${runId}|`)) {
      toast.removeByKey(key);
      shown.delete(key);
    }
  }
}

function argPreview(args: unknown): string {
  try {
    const s = redactSecrets(typeof args === "string" ? args : JSON.stringify(args));
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return String(args);
  }
}

/**
 * The toast line for a pending approval: the call and where it came from.
 * Never the agent id (a chat agent's is a bare ULID, a desk run's a name plus
 * a timestamp); the Runs strip and the chat card name the run.
 */
export function approvalToastMessage(p: Pick<Pending, "toolName" | "args" | "chatSessionId" | "subAgent">): string {
  const who = p.subAgent ? `${p.subAgent} wants ` : "";
  return `${who}${p.toolName}(${argPreview(p.args)}) · ${p.chatSessionId ? "from a chat" : "from a desk run"}`;
}

/** Answer one pending approval by its gate: parallel sub-agents share the run id, so the gate says which. */
async function decide(p: Pick<Pending, "runId" | "gateId">, action: "approve" | "deny"): Promise<void> {
  try {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(p.runId)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(action === "deny" ? { reason: "Denied from Cortex" } : {}),
        ...(p.gateId ? { gateId: p.gateId } : {}),
      }),
    });
    if (res.ok) clearApproval(p.runId, p.gateId || undefined);
  } catch {
    /* network / server error — next poll re-surfaces if still pending */
  }
}

/**
 * Bring the toasts in line with what is pending and what is on screen: show one
 * for each pending approval that is not on screen, remove the rest.
 */
function reconcile(approvals: readonly Pending[], view: ApprovalView): void {
  const wanted = new Map<string, Pending>();
  for (const p of approvals) if (showToast(p, view)) wanted.set(keyFor(p), p);
  for (const key of [...shown]) {
    if (!wanted.has(key)) {
      toast.removeByKey(key);
      shown.delete(key);
    }
  }
  for (const [key, p] of wanted) {
    if (shown.has(key)) continue;
    shown.add(key);
    toast.prompt({
      kind: "warning",
      title: "Approval needed",
      message: approvalToastMessage(p),
      key,
      buttons: [
        { label: "Approve", variant: "primary", onClick: () => decide(p, "approve") },
        { label: "Deny", variant: "danger", onClick: () => decide(p, "deny") },
      ],
    });
  }
}

/**
 * Start polling for pending approvals and prompting via toasts. Returns a stop fn.
 */
export function startApprovalWatcher(pollMs = 2500): () => void {
  async function poll(): Promise<void> {
    let approvals: Pending[] = [];
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/pending-approvals`);
      if (!res.ok) return;
      approvals = ((await res.json()) as { approvals?: Pending[] }).approvals ?? [];
    } catch {
      return;
    }
    pendingApprovals.set(approvals);
  }

  // Re-decide the toasts whenever the pending list or the view changes (opening the chat removes its toast).
  let latest: readonly Pending[] = [];
  let view: ApprovalView = get(approvalView);
  const offPending = pendingApprovals.subscribe((list) => {
    latest = list;
    reconcile(latest, view);
  });
  const offView = approvalView.subscribe((v) => {
    view = v;
    reconcile(latest, view);
  });

  void poll();
  const timer = setInterval(() => void poll(), pollMs);
  return () => {
    clearInterval(timer);
    offPending();
    offView();
  };
}
