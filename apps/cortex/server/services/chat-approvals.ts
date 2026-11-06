/**
 * Chat approvals: a chat turn that paused on a durable approval gate.
 *
 * With `durableRuns` + an approval policy, a chat turn's run checkpoints and pauses
 * before the gated tool (`StreamCompleted.pendingApproval`). This module:
 *   - holds the paused turn as a `chat_pending_approvals` row (the user message stays
 *     here, not in the thread, until a reply exists, so history alternation holds),
 *   - registers it in the shared `durableApprovals` registry as an owner-managed entry,
 *     so `GET /api/runs/pending-approvals` lists it and the desk approve/deny routes
 *     reach it,
 *   - resolves it: `approveRun` / `denyRun` on the session's agent, then the resumed
 *     output lands as the assistant reply of the paused exchange.
 *
 * Restart: rows survive; `restore()` re-registers them at boot. Resolving after a
 * restart rebuilds the session agent and resumes from the durable store, which works
 * as long as the session's agent config (hence the durable config hash) is unchanged.
 *
 * A turn can also pause on `request_user_input` (`pendingInteraction`). That pause is
 * held the same way in `chat_pending_interactions` (not registered for the desk
 * approval list: it is a question, not a gate). `respond()` resumes the run with the
 * user's answer via `respondToInteraction`; the question and the answer land in the
 * thread as their own exchange, so history alternation holds and the next turn sees
 * them. Pauses chain: an approval can resume into a question and back.
 */
import type { Database } from "bun:sqlite";
import type { AgentResult, ReactiveAgent } from "@reactive-agents/runtime";
import { durableApprovals, type ApprovalDecision, type PendingGate } from "./durable-approvals.js";

/** A paused chat turn, as the REST API returns it. */
export interface ChatPendingApproval {
  readonly runId: string;
  readonly sessionId: string;
  readonly userMessage: string;
  readonly gateId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly createdAt: number;
}

/** A chat turn paused on `request_user_input`, as the REST API returns it. */
export interface ChatPendingInteraction {
  readonly runId: string;
  readonly sessionId: string;
  /** What the user last said before the question: the original message, or their previous answer. */
  readonly userMessage: string;
  readonly interactionId: string;
  /** `form` | `choice` | `confirmation` (the tool's enum; other strings are shown as free text). */
  readonly kind: string;
  readonly prompt: string;
  readonly schema: unknown;
  readonly createdAt: number;
}

/** The pause descriptors a run result or `StreamCompleted` event can carry. */
export interface PauseCarrier {
  readonly pendingApproval?: AgentResult["pendingApproval"];
  readonly pendingInteraction?: AgentResult["pendingInteraction"];
}

/** The agent surface resolution needs. */
export type ApprovableAgent = Pick<ReactiveAgent, "approveRun" | "denyRun" | "respondToInteraction">;

/** What chat approvals need from the chat session service (injected; no hidden globals). */
export interface ChatApprovalHost {
  /** Take the session's turn guard; throws `ChatSessionBusyError` when a turn is in flight. */
  acquireTurn(sessionId: string): () => void;
  /** The session's agent: the cached one, or rebuilt from the stored config. */
  agentFor(sessionId: string): Promise<ApprovableAgent>;
  /** The agent id the session reports under (its stable id). */
  agentIdFor(sessionId: string): string | undefined;
  /**
   * Persist an exchange (user message + reply). `result` carries tokens, cost and run id;
   * it is absent for the agent's question half of an answered `request_user_input`.
   */
  persistExchange(sessionId: string, userMessage: string, reply: string, result: AgentResult | undefined, toolsUsed: readonly string[]): void;
  /** Drop the cached agent so the next turn rebuilds history from the DB. */
  evict(sessionId: string): Promise<void>;
}

/** Outcome of {@link ChatApprovals.resolve}. */
export type ChatApprovalOutcome =
  | { readonly ok: true; readonly status: "completed"; readonly reply: string; readonly success: boolean }
  | { readonly ok: true; readonly status: "awaiting-approval"; readonly pending: ChatPendingApproval }
  | { readonly ok: true; readonly status: "awaiting-interaction"; readonly pending: ChatPendingInteraction }
  | { readonly ok: false; readonly code: "not-found" | "busy" | "failed"; readonly message: string };

/** Denial reason sent to the run when the user gives none. */
export const DEFAULT_DENY_REASON = "Denied by the user in Cortex chat.";

interface Row {
  run_id: string;
  session_id: string;
  user_message: string;
  gate_id: string;
  tool_name: string;
  args_json: string;
  created_at: number;
}

const rowToPending = (r: Row): ChatPendingApproval => {
  let args: unknown = null;
  try {
    args = JSON.parse(r.args_json) as unknown;
  } catch {
    args = r.args_json;
  }
  return {
    runId: r.run_id,
    sessionId: r.session_id,
    userMessage: r.user_message,
    gateId: r.gate_id,
    toolName: r.tool_name,
    args,
    createdAt: r.created_at,
  };
};

interface InteractionRow {
  run_id: string;
  session_id: string;
  user_message: string;
  interaction_id: string;
  kind: string;
  prompt: string;
  schema_json: string;
  created_at: number;
}

const rowToInteraction = (r: InteractionRow): ChatPendingInteraction => {
  let schema: unknown = {};
  try {
    schema = JSON.parse(r.schema_json) as unknown;
  } catch {
    schema = {};
  }
  return {
    runId: r.run_id,
    sessionId: r.session_id,
    userMessage: r.user_message,
    interactionId: r.interaction_id,
    kind: r.kind,
    prompt: r.prompt,
    schema,
    createdAt: r.created_at,
  };
};

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const showValue = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

/**
 * The user's answer to a `request_user_input` question as it lands in the thread:
 * text as typed, a confirmation as Yes / No, form values one `name: value` per line.
 */
export function answerText(value: unknown): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${showValue(v)}`)
      .join("\n");
  }
  if (Array.isArray(value)) return value.map(showValue).join(", ");
  return value === null || value === undefined ? "" : showValue(value);
}

/**
 * The reply a resumed run lands in the thread. A run that paused to ask the user
 * (`request_user_input`) has only a placeholder `output`; in chat its question IS the
 * reply, and the user answers with their next message.
 */
export function replyOf(result: Pick<AgentResult, "output" | "status" | "pendingInteraction">): string {
  if (result.status === "awaiting-interaction" && result.pendingInteraction?.prompt) return result.pendingInteraction.prompt;
  return result.output;
}

export class ChatApprovals {
  constructor(
    private readonly db: Database,
    private readonly host: ChatApprovalHost,
    private readonly now: () => number = Date.now,
  ) {}

  /** Paused turns of a session, oldest first. */
  list(sessionId: string): ChatPendingApproval[] {
    const rows = this.db
      .prepare(`SELECT * FROM chat_pending_approvals WHERE session_id = ? ORDER BY created_at ASC, run_id ASC`)
      .all(sessionId) as Row[];
    return rows.map(rowToPending);
  }

  /** Turns of a session paused on `request_user_input`, oldest first. */
  listInteractions(sessionId: string): ChatPendingInteraction[] {
    const rows = this.db
      .prepare(`SELECT * FROM chat_pending_interactions WHERE session_id = ? ORDER BY created_at ASC, run_id ASC`)
      .all(sessionId) as InteractionRow[];
    return rows.map(rowToInteraction);
  }

  /** True when the session has a paused turn of either kind (new turns are refused until it is resolved). */
  hasPending(sessionId: string): boolean {
    return (
      this.db.prepare(`SELECT 1 FROM chat_pending_approvals WHERE session_id = ? LIMIT 1`).get(sessionId) != null ||
      this.db.prepare(`SELECT 1 FROM chat_pending_interactions WHERE session_id = ? LIMIT 1`).get(sessionId) != null
    );
  }

  private get(sessionId: string, runId: string): ChatPendingApproval | undefined {
    const row = this.db
      .prepare(`SELECT * FROM chat_pending_approvals WHERE session_id = ? AND run_id = ?`)
      .get(sessionId, runId) as Row | null;
    return row ? rowToPending(row) : undefined;
  }

  private getInteraction(sessionId: string, runId: string): ChatPendingInteraction | undefined {
    const row = this.db
      .prepare(`SELECT * FROM chat_pending_interactions WHERE session_id = ? AND run_id = ?`)
      .get(sessionId, runId) as InteractionRow | null;
    return row ? rowToInteraction(row) : undefined;
  }

  /** Record a turn paused on `request_user_input`. */
  onInteractionPaused(
    sessionId: string,
    userMessage: string,
    p: NonNullable<AgentResult["pendingInteraction"]>,
  ): ChatPendingInteraction {
    this.db
      .prepare(
        `INSERT INTO chat_pending_interactions (run_id, session_id, user_message, interaction_id, kind, prompt, schema_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET user_message = excluded.user_message, interaction_id = excluded.interaction_id,
           kind = excluded.kind, prompt = excluded.prompt, schema_json = excluded.schema_json`,
      )
      .run(p.runId, sessionId, userMessage, p.interactionId, p.kind, p.prompt, JSON.stringify(p.schema ?? {}), this.now());
    return this.getInteraction(sessionId, p.runId)!;
  }

  /**
   * Hold a turn whose run paused (approval gate or `request_user_input`) instead of
   * saving its placeholder output as a reply. Returns true when it held one; the
   * caller then persists nothing for the turn.
   */
  holdIfPaused(sessionId: string, userMessage: string, done: PauseCarrier): boolean {
    if (done.pendingApproval) {
      this.onPaused(sessionId, userMessage, done.pendingApproval);
      return true;
    }
    if (done.pendingInteraction) {
      this.onInteractionPaused(sessionId, userMessage, done.pendingInteraction);
      return true;
    }
    return false;
  }

  /** Record a paused turn and register it for the desk approval list. */
  onPaused(sessionId: string, userMessage: string, gate: PendingGate & { readonly runId: string }): ChatPendingApproval {
    this.db
      .prepare(
        `INSERT INTO chat_pending_approvals (run_id, session_id, user_message, gate_id, tool_name, args_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET gate_id = excluded.gate_id, tool_name = excluded.tool_name, args_json = excluded.args_json`,
      )
      .run(gate.runId, sessionId, userMessage, gate.gateId, gate.toolName, JSON.stringify(gate.args ?? null), this.now());
    const pending = this.get(sessionId, gate.runId)!;
    this.register(pending);
    return pending;
  }

  /** Re-register every stored paused turn (server boot). Returns how many. */
  restore(): number {
    const rows = this.db.prepare(`SELECT * FROM chat_pending_approvals ORDER BY created_at ASC`).all() as Row[];
    for (const r of rows) this.register(rowToPending(r));
    return rows.length;
  }

  private register(p: ChatPendingApproval): void {
    durableApprovals.register({
      agentId: this.host.agentIdFor(p.sessionId) ?? p.sessionId,
      durableRunId: p.runId,
      startedAt: p.createdAt,
      owner: {
        kind: "chat",
        sessionId: p.sessionId,
        gate: { gateId: p.gateId, toolName: p.toolName, args: p.args },
        decide: async (decision, reason) => {
          const out = await this.resolve(p.sessionId, p.runId, decision, reason);
          if (out.ok) return { ok: true };
          return { ok: false, code: out.code === "not-found" ? "not-found" : "failed", message: out.message };
        },
      },
    });
  }

  /** Drop a paused turn (approval or question) without resuming it (the user gave up on it). */
  async dismiss(sessionId: string, runId: string): Promise<boolean> {
    const a = this.db.prepare(`DELETE FROM chat_pending_approvals WHERE session_id = ? AND run_id = ?`).run(sessionId, runId);
    const i = this.db.prepare(`DELETE FROM chat_pending_interactions WHERE session_id = ? AND run_id = ?`).run(sessionId, runId);
    await durableApprovals.finalize(runId);
    return a.changes + i.changes > 0;
  }

  /** Forget every paused turn of a session (session deleted / cleared). */
  async forgetSession(sessionId: string): Promise<void> {
    for (const p of [...this.list(sessionId), ...this.listInteractions(sessionId)]) await this.dismiss(sessionId, p.runId);
  }

  /**
   * Approve or deny a paused turn. The run resumes from its checkpoint; a re-pause on
   * another gate updates the row, completion lands the reply in the thread.
   */
  async resolve(sessionId: string, runId: string, decision: ApprovalDecision, reason?: string): Promise<ChatApprovalOutcome> {
    const pending = this.get(sessionId, runId);
    if (!pending) return { ok: false, code: "not-found", message: `No paused turn ${runId} in session ${sessionId}` };
    let release: () => void;
    try {
      release = this.host.acquireTurn(sessionId);
    } catch (e) {
      return { ok: false, code: "busy", message: errorMessage(e) };
    }
    try {
      let result: AgentResult;
      try {
        const agent = await this.host.agentFor(sessionId);
        result =
          decision === "approved"
            ? await agent.approveRun(runId, reason ? { reason } : undefined)
            : await agent.denyRun(runId, reason?.trim() ? reason : DEFAULT_DENY_REASON);
      } catch (e) {
        return { ok: false, code: "failed", message: errorMessage(e) };
      }
      // The gated tool ran only on approval; other tools the resumed run used are in its trace.
      return await this.settle(sessionId, runId, pending.userMessage, result, decision === "approved" ? [pending.toolName] : []);
    } finally {
      release();
    }
  }

  /**
   * Answer a turn paused on `request_user_input`. The run resumes with `value`
   * (`respondToInteraction`); the question and the answer land in the thread as their
   * own exchange, then the run's reply (or its next pause) follows the answer.
   */
  async respond(sessionId: string, runId: string, value: unknown): Promise<ChatApprovalOutcome> {
    const pending = this.getInteraction(sessionId, runId);
    if (!pending) return { ok: false, code: "not-found", message: `No turn ${runId} waiting for a reply in session ${sessionId}` };
    let release: () => void;
    try {
      release = this.host.acquireTurn(sessionId);
    } catch (e) {
      return { ok: false, code: "busy", message: errorMessage(e) };
    }
    try {
      let result: AgentResult;
      try {
        const agent = await this.host.agentFor(sessionId);
        result = await agent.respondToInteraction(runId, pending.interactionId, value);
      } catch (e) {
        return { ok: false, code: "failed", message: errorMessage(e) };
      }
      return await this.settle(sessionId, runId, pending.userMessage, result, [], { question: pending.prompt, answer: answerText(value) });
    } finally {
      release();
    }
  }

  /**
   * Land a resumed run: a re-pause is held again (approval or question), completion
   * lands the reply. `asked` is the answered question: it is persisted as its own
   * exchange first, and the answer becomes the user message the rest follows.
   */
  private async settle(
    sessionId: string,
    runId: string,
    userMessage: string,
    result: AgentResult,
    toolsUsed: readonly string[],
    asked?: { readonly question: string; readonly answer: string },
  ): Promise<ChatApprovalOutcome> {
    this.db.prepare(`DELETE FROM chat_pending_interactions WHERE run_id = ?`).run(runId);
    let said = userMessage;
    if (asked) {
      this.host.persistExchange(sessionId, userMessage, asked.question, undefined, []);
      said = asked.answer;
    }
    let outcome: ChatApprovalOutcome;
    if (result.status === "awaiting-approval" && result.pendingApproval) {
      outcome = { ok: true, status: "awaiting-approval", pending: this.onPaused(sessionId, said, result.pendingApproval) };
    } else {
      this.db.prepare(`DELETE FROM chat_pending_approvals WHERE run_id = ?`).run(runId);
      await durableApprovals.finalize(runId);
      if (result.status === "awaiting-interaction" && result.pendingInteraction) {
        outcome = { ok: true, status: "awaiting-interaction", pending: this.onInteractionPaused(sessionId, said, result.pendingInteraction) };
      } else {
        const reply = replyOf(result);
        this.host.persistExchange(sessionId, said, reply, result, toolsUsed);
        outcome = { ok: true, status: "completed", reply, success: result.success };
      }
    }
    // The cached engine recorded the paused exchange; once the thread changed, rebuild history from the DB.
    if (asked || (outcome.ok && outcome.status === "completed")) await this.host.evict(sessionId);
    return outcome;
  }
}
