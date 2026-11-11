/**
 * durable-approvals.ts — process-wide registry of durable runs paused awaiting
 * human approval.
 *
 * Cortex has THREE paths that can pause on a durable HITL gate:
 *   - CortexRunnerService (Lab "Run" / Beacon stage — direct `/api/runs`),
 *   - GatewayProcessManager (saved-agent trigger / schedule), and
 *   - chat sessions (`chat-approvals.ts`), whose agent belongs to the session cache.
 *
 * This singleton lets all of them register under the DURABLE runId so the shared
 * `/api/runs/pending-approvals` + approve/deny endpoints work regardless of which
 * path started the run.
 *
 * Two entry kinds:
 *   - agent-owned (runner, gateway): the registry holds the retained agent, drives
 *     `approveRun`/`denyRun` itself and disposes the agent when the run resolves.
 *   - owner-managed (chat): the registry never touches an agent. Listing reads the
 *     gate snapshot and approve/deny delegate to `owner.decide`, so a desk approval
 *     of a chat turn still lands its reply in the chat thread.
 *
 * Live waits (no durable runs): a `detach` approval policy without durable runs
 * makes the run wait IN PROCESS for a person (runtime `engine/human-gate.ts`): the
 * run stays alive and `approveRun`/`denyRun` answer the waiter. Every path that
 * runs such an agent registers it as a live source ({@link durableApprovals.watchLive})
 * while it runs. Listing asks each source's `listPendingApprovals()` (live waits
 * only: the agent has no store); approve/deny of a run not registered above go to
 * the source that holds the wait. The run's own caller still owns its result.
 */
import type { ReactiveAgent } from "@reactive-agents/runtime";
import { cortexLog } from "../cortex-log.js";

/** The paused gate as the framework reports it (`AgentResult.pendingApproval`). */
export interface PendingGate {
  readonly gateId: string;
  readonly toolName: string;
  readonly args: unknown;
}

/** A human decision on a paused gate. */
export type ApprovalDecision = "approved" | "denied";

/** Result of applying a decision: `not-found` when the run is not registered. */
export type DecideResult = { readonly ok: true } | { readonly ok: false; readonly code: "not-found" | "failed"; readonly message: string };

/** Owner of a paused run whose agent the registry must not drive or dispose. */
export interface PendingApprovalOwner {
  readonly kind: "chat";
  readonly sessionId: string;
  readonly gate: PendingGate;
  /** Apply the decision. Resolves once the owner has resumed the run, or with the reason it could not. */
  readonly decide: (decision: ApprovalDecision, reason?: string) => Promise<DecideResult>;
}

interface PendingApprovalBase {
  readonly agentId: string;
  /** The DURABLE runId (runDurable mints it) — the key approve/deny use. */
  readonly durableRunId: string;
  readonly startedAt: number;
}

/** A registered paused run: agent-owned (runner/gateway) or owner-managed (chat). */
export type PendingApprovalEntry =
  | (PendingApprovalBase & { readonly agent: ReactiveAgent; readonly owner?: undefined })
  | (PendingApprovalBase & { readonly owner: PendingApprovalOwner; readonly agent?: undefined });

/** One row of `GET /api/runs/pending-approvals`. `chatSessionId` is set for chat turns. */
export interface PendingApprovalRow {
  readonly runId: string;
  readonly agentId: string;
  readonly gateId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly chatSessionId?: string;
}

/** The agent surface a live wait is read and answered through. */
export type LiveApprovableAgent = Pick<ReactiveAgent, "listPendingApprovals" | "approveRun" | "denyRun">;

/** A running agent whose `detach` approvals wait live (no durable store). */
export interface LiveApprovalSource {
  /** The agent id rows report (the Cortex agent's, or the chat session's stable id). */
  readonly agentId: string;
  readonly agent: LiveApprovableAgent;
  /** Set when the agent backs a chat session, so the row links back to it. */
  readonly chatSessionId?: string;
}

/**
 * True when a build's `detach` approvals wait live: a gate in `detach` mode and
 * no durable runs (with durable runs the run pauses durably instead).
 */
export function approvalsWaitLive(p: {
  readonly durableRuns?: { readonly enabled?: boolean };
  readonly approvalPolicy?: { readonly mode: string };
}): boolean {
  return p.approvalPolicy?.mode === "detach" && p.durableRuns?.enabled !== true;
}

const pending = new Map<string, PendingApprovalEntry>();
const liveSources = new Set<LiveApprovalSource>();

/** A source's live waits; an agent that cannot list them lists none. */
const liveRowsOf = async (
  source: LiveApprovalSource,
): Promise<readonly { runId: string; gateId: string; toolName: string; args: unknown }[]> => {
  try {
    return await source.agent.listPendingApprovals();
  } catch {
    return [];
  }
};

export const durableApprovals = {
  /** Retain a paused run keyed by its durable runId (re-registering replaces). */
  register(entry: PendingApprovalEntry): void {
    pending.set(entry.durableRunId, entry);
  },
  get(durableRunId: string): PendingApprovalEntry | undefined {
    return pending.get(durableRunId);
  },
  list(): readonly PendingApprovalEntry[] {
    return [...pending.values()];
  },
  /**
   * Pending gates across every registered run. Agent-owned entries are read from
   * the agent's durable store; owner-managed entries from their gate snapshot.
   * Deduped by runId: two agents sharing a durable dir both list every paused run
   * in that store.
   */
  async listPending(): Promise<readonly PendingApprovalRow[]> {
    const out = new Map<string, PendingApprovalRow>();
    for (const entry of pending.values()) {
      if (entry.owner) {
        const { gate, sessionId } = entry.owner;
        out.set(entry.durableRunId, {
          runId: entry.durableRunId,
          agentId: entry.agentId,
          gateId: gate.gateId,
          toolName: gate.toolName,
          args: gate.args,
          chatSessionId: sessionId,
        });
        continue;
      }
      let rows: readonly { runId?: string; gateId?: string; toolName?: string; args?: unknown }[] = [];
      try {
        rows = await entry.agent.listPendingApprovals();
      } catch {
        rows = [];
      }
      for (const p of rows) {
        const runId = p.runId ?? entry.durableRunId;
        if (out.has(runId)) continue;
        out.set(runId, {
          runId,
          agentId: entry.agentId,
          gateId: p.gateId ?? "",
          toolName: p.toolName ?? "",
          args: p.args ?? null,
        });
      }
    }
    for (const source of liveSources) {
      for (const p of await liveRowsOf(source)) {
        if (out.has(p.runId)) continue;
        out.set(p.runId, {
          runId: p.runId,
          agentId: source.agentId,
          gateId: p.gateId,
          toolName: p.toolName,
          args: p.args ?? null,
          ...(source.chatSessionId !== undefined ? { chatSessionId: source.chatSessionId } : {}),
        });
      }
    }
    return [...out.values()];
  },
  /**
   * Register a running agent whose approvals wait live. Returns the unregister;
   * call it when the run (or the chat session's agent) ends.
   */
  watchLive(source: LiveApprovalSource): () => void {
    liveSources.add(source);
    return () => {
      liveSources.delete(source);
    };
  },
  /**
   * Answer a run waiting live in this process. `not-found` when no live source
   * holds a wait for `runId`. The decision is delivered, not awaited to the
   * run's end: the run continues on its own caller, which reports how it ends.
   */
  async decideLive(runId: string, decision: ApprovalDecision, reason?: string): Promise<DecideResult> {
    for (const source of liveSources) {
      const rows = await liveRowsOf(source);
      if (!rows.some((r) => r.runId === runId)) continue;
      const answered =
        decision === "approved"
          ? source.agent.approveRun(runId, reason ? { reason } : undefined)
          : source.agent.denyRun(runId, reason?.trim() ? reason : "Denied in Cortex");
      // Resolves (or rejects) when the run ends; its own caller handles that.
      void answered.catch((e: unknown) => {
        cortexLog("debug", "approvals", "live run ended with an error after a decision", {
          runId,
          error: e instanceof Error ? e.message : String(e),
        });
      });
      return { ok: true };
    }
    return { ok: false, code: "not-found", message: `Run ${runId} is not waiting for approval in this process` };
  },
  /**
   * Approve or deny a registered run. Agent-owned: resume via the agent, keep it
   * registered if it re-paused, otherwise finalize. Owner-managed: delegate.
   */
  async decide(durableRunId: string, decision: ApprovalDecision, reason?: string): Promise<DecideResult> {
    const entry = pending.get(durableRunId);
    if (!entry) return durableApprovals.decideLive(durableRunId, decision, reason);
    if (entry.owner) return entry.owner.decide(decision, reason);
    const agent = entry.agent;
    try {
      if (decision === "approved") {
        const result = await agent.approveRun(durableRunId, reason ? { reason } : undefined);
        if (result.status === "awaiting-approval") return { ok: true };
      } else {
        await agent.denyRun(durableRunId, reason ?? "Denied in Cortex");
      }
    } catch (e) {
      return { ok: false, code: "failed", message: e instanceof Error ? e.message : String(e) };
    }
    await durableApprovals.finalize(durableRunId);
    return { ok: true };
  },
  /**
   * Drop + dispose every OTHER paused run of `agentId`. A relaunch of the same
   * agent supersedes its earlier paused run (the user retried instead of
   * answering it); keeping both stacks identical approval prompts forever.
   * Returns the superseded durable runIds.
   */
  async supersedeForAgent(agentId: string, keepDurableRunId: string): Promise<readonly string[]> {
    const stale = [...pending.values()].filter((e) => !e.owner && e.agentId === agentId && e.durableRunId !== keepDurableRunId);
    for (const e of stale) await durableApprovals.finalize(e.durableRunId);
    return stale.map((e) => e.durableRunId);
  },
  /** Drop a resolved entry; an agent-owned entry's agent is disposed (best-effort). */
  async finalize(durableRunId: string): Promise<void> {
    const entry = pending.get(durableRunId);
    pending.delete(durableRunId);
    if (entry?.agent) {
      try {
        await entry.agent.dispose();
      } catch {
        /* dispose is best-effort */
      }
    }
  },
};
