/**
 * durable-approvals.ts — process-wide registry of durable runs paused awaiting
 * human approval.
 *
 * Cortex has TWO launch paths that both call `agent.run()`:
 *   - CortexRunnerService (Lab "Run" / Beacon stage — direct `/api/runs`), and
 *   - GatewayProcessManager (saved-agent trigger / schedule).
 *
 * Either can pause on a durable HITL gate. This singleton lets BOTH register the
 * retained (not-disposed) agent under its DURABLE runId so the shared
 * `/api/runs/pending-approvals` + approve/deny endpoints work regardless of which
 * path started the run. In-process / live-session scope (cross-restart resume is
 * a separate concern).
 */
import type { ReactiveAgent } from "@reactive-agents/runtime";

export interface PendingApprovalEntry {
  readonly agentId: string;
  /** The DURABLE runId (runDurable mints it) — the key approve/deny use. */
  readonly durableRunId: string;
  readonly agent: ReactiveAgent;
  readonly startedAt: number;
}

const pending = new Map<string, PendingApprovalEntry>();

export const durableApprovals = {
  /** Retain a paused agent keyed by its durable runId. */
  register(entry: PendingApprovalEntry): void {
    pending.set(entry.durableRunId, entry);
  },
  get(durableRunId: string): PendingApprovalEntry | undefined {
    return pending.get(durableRunId);
  },
  list(): readonly PendingApprovalEntry[] {
    return [...pending.values()];
  },
  /** Drop + (best-effort) dispose a resolved entry. */
  async finalize(durableRunId: string): Promise<void> {
    const entry = pending.get(durableRunId);
    pending.delete(durableRunId);
    if (entry) {
      try {
        await entry.agent.dispose();
      } catch {
        /* dispose is best-effort */
      }
    }
  },
};
