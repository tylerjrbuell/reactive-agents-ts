/**
 * approval-watcher.ts — app-wide durable-HITL approval prompts.
 *
 * Polls `/api/runs/pending-approvals` and raises an interactive toast (Approve /
 * Deny) for each NEW pending approval, anywhere in the app — complementing the
 * trace-page Approval panel. Resolving from either surface clears both (they
 * share the server-side registry); a toast also auto-clears when its approval
 * stops being pending.
 */
import { toast } from "./toast-store.js";
import { CORTEX_SERVER_URL } from "../constants.js";

interface Pending {
  readonly runId: string;
  readonly agentId: string;
  readonly gateId: string;
  readonly toolName: string;
  readonly args: unknown;
}

const keyFor = (p: Pending) => `approval:${p.runId}|${p.gateId}`;

function argPreview(args: unknown): string {
  try {
    const s = typeof args === "string" ? args : JSON.stringify(args);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return String(args);
  }
}

async function decide(runId: string, action: "approve" | "deny"): Promise<void> {
  try {
    await fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "deny" ? { reason: "Denied from Cortex" } : {}),
    });
  } catch {
    /* network / server error — next poll re-surfaces if still pending */
  }
}

/**
 * Start polling for pending approvals and prompting via toasts. Returns a stop fn.
 */
export function startApprovalWatcher(pollMs = 2500): () => void {
  const prompted = new Set<string>();

  async function poll(): Promise<void> {
    let approvals: Pending[] = [];
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/pending-approvals`);
      if (!res.ok) return;
      approvals = ((await res.json()) as { approvals?: Pending[] }).approvals ?? [];
    } catch {
      return;
    }

    const active = new Set(approvals.map(keyFor));

    for (const p of approvals) {
      const key = keyFor(p);
      if (prompted.has(key)) continue;
      prompted.add(key);
      toast.prompt({
        kind: "warning",
        title: "Approval needed",
        message: `${p.toolName}(${argPreview(p.args)})  ·  ${p.agentId.slice(0, 18)}`,
        key,
        buttons: [
          { label: "Approve", variant: "primary", onClick: () => decide(p.runId, "approve") },
          { label: "Deny", variant: "danger", onClick: () => decide(p.runId, "deny") },
        ],
      });
    }

    // Clear toasts whose approval is no longer pending (resolved elsewhere).
    for (const key of [...prompted]) {
      if (!active.has(key)) {
        toast.removeByKey(key);
        prompted.delete(key);
      }
    }
  }

  void poll();
  const timer = setInterval(() => void poll(), pollMs);
  return () => clearInterval(timer);
}
