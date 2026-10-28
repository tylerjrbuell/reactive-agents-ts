import type { Database } from "bun:sqlite";
import { generateTaskId } from "@reactive-agents/core";
import type { StoredTurnTrace } from "../services/chat-turn-trace.js";

export type ChatSessionRow = {
  sessionId: string;
  name: string;
  agentConfig: Record<string, unknown>;
  createdAt: number;
  lastUsedAt: number;
  /** Stable agentId generated at session creation for persistent memory. */
  stableAgentId?: string;
};

export type ChatTurnRow = {
  id: number;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  tokensUsed: number;
  /** Tool names from the tool-capable chat path (assistant turns only). */
  toolsUsed?: string[];
  /** Thinking + per-call tool detail so a reloaded chat can show what happened (assistant turns only). */
  trace?: StoredTurnTrace;
  /** Provider / model that produced the turn (assistant turns persisted after this was tracked). */
  provider?: string;
  model?: string;
  ts: number;
};

export function createChatSession(
  db: Database,
  opts: { name?: string; agentConfig: Record<string, unknown>; stableAgentId?: string },
): string {
  const sessionId = generateTaskId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO cortex_chat_sessions (session_id, name, agent_config, stable_agent_id, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, opts.name ?? "New Chat", JSON.stringify(opts.agentConfig), opts.stableAgentId ?? null, now, now);
  return sessionId;
}

export function getChatSession(db: Database, sessionId: string): ChatSessionRow | null {
  const row = db
    .prepare(
      `SELECT session_id, name, agent_config, stable_agent_id, created_at, last_used_at
       FROM cortex_chat_sessions WHERE session_id = ?`,
    )
    .get(sessionId) as
    | {
        session_id: string;
        name: string;
        agent_config: string;
        stable_agent_id: string | null;
        created_at: number;
        last_used_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    name: row.name,
    agentConfig: JSON.parse(row.agent_config) as Record<string, unknown>,
    ...(row.stable_agent_id ? { stableAgentId: row.stable_agent_id } : {}),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function listChatSessions(db: Database): ChatSessionRow[] {
  const rows = db
    .prepare(
      `SELECT session_id, name, agent_config, stable_agent_id, created_at, last_used_at
       FROM cortex_chat_sessions ORDER BY last_used_at DESC LIMIT 100`,
    )
    .all() as Array<{
    session_id: string;
    name: string;
    agent_config: string;
    stable_agent_id: string | null;
    created_at: number;
    last_used_at: number;
  }>;
  return rows.map((r) => ({
    sessionId: r.session_id,
    name: r.name,
    agentConfig: JSON.parse(r.agent_config) as Record<string, unknown>,
    ...(r.stable_agent_id ? { stableAgentId: r.stable_agent_id } : {}),
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

export function deleteChatSession(db: Database, sessionId: string): boolean {
  const result = db.prepare(`DELETE FROM cortex_chat_sessions WHERE session_id = ?`).run(sessionId);
  return result.changes > 0;
}

/**
 * Delete chat sessions whose persisted `agent_config` includes this `runId`
 * (run-scoped desk / run-panel chat). Turns cascade via FK on `cortex_chat_turns`.
 */
export function deleteChatSessionsForRun(db: Database, runId: string): number {
  const trimmed = runId.trim();
  if (trimmed.length === 0) return 0;
  const result = db
    .prepare(
      `DELETE FROM cortex_chat_sessions WHERE json_extract(agent_config, '$.runId') = ?`,
    )
    .run(trimmed) as { changes?: number };
  return result.changes ?? 0;
}

export function appendChatTurn(
  db: Database,
  turn: {
    sessionId: string;
    role: "user" | "assistant";
    content: string;
    tokensUsed: number;
    toolsUsed?: readonly string[];
    trace?: StoredTurnTrace;
    provider?: string;
    model?: string;
  },
): void {
  const traceJson = turn.trace ? JSON.stringify(turn.trace) : null;
  const toolsJson =
    turn.toolsUsed && turn.toolsUsed.length > 0 ? JSON.stringify([...turn.toolsUsed]) : null;
  db.prepare(
    `INSERT INTO cortex_chat_turns (session_id, role, content, tokens_used, tools_json, trace_json, provider, model, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(turn.sessionId, turn.role, turn.content, turn.tokensUsed, toolsJson, traceJson, turn.provider ?? null, turn.model ?? null, Date.now());
}

export function getChatTurns(db: Database, sessionId: string): ChatTurnRow[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, role, content, tokens_used, tools_json, trace_json, provider, model, ts FROM cortex_chat_turns WHERE session_id = ? ORDER BY id ASC`,
    )
    .all(sessionId) as Array<{
    id: number;
    session_id: string;
    role: string;
    content: string;
    tokens_used: number;
    tools_json: string | null;
    trace_json: string | null;
    provider: string | null;
    model: string | null;
    ts: number;
  }>;
  return rows.map((r) => {
    let toolsUsed: string[] | undefined;
    if (r.tools_json) {
      try {
        const parsed = JSON.parse(r.tools_json) as unknown;
        if (Array.isArray(parsed)) {
          toolsUsed = parsed.filter((x): x is string => typeof x === "string");
        }
      } catch {
        /* ignore */
      }
    }
    let trace: StoredTurnTrace | undefined;
    if (r.trace_json) {
      try {
        const parsed = JSON.parse(r.trace_json) as Partial<StoredTurnTrace>;
        if (Array.isArray(parsed.reasoningSteps) && Array.isArray(parsed.toolCalls)) {
          trace = { reasoningSteps: parsed.reasoningSteps, toolCalls: parsed.toolCalls };
        }
      } catch {
        /* ignore a corrupt trace — the turn still renders from content */
      }
    }
    return {
      id: r.id,
      sessionId: r.session_id,
      role: r.role as "user" | "assistant",
      content: r.content,
      tokensUsed: r.tokens_used,
      ...(toolsUsed && toolsUsed.length > 0 ? { toolsUsed } : {}),
      ...(trace ? { trace } : {}),
      ...(r.provider ? { provider: r.provider } : {}),
      ...(r.model ? { model: r.model } : {}),
      ts: r.ts,
    };
  });
}

export function updateSessionLastUsed(db: Database, sessionId: string): void {
  db.prepare(`UPDATE cortex_chat_sessions SET last_used_at = ? WHERE session_id = ?`).run(Date.now(), sessionId);
}

export function renameSession(db: Database, sessionId: string, name: string): void {
  db.prepare(`UPDATE cortex_chat_sessions SET name = ? WHERE session_id = ?`).run(name.trim(), sessionId);
}

export function updateSessionAgentConfig(
  db: Database,
  sessionId: string,
  agentConfig: Record<string, unknown>,
): boolean {
  const result = db
    .prepare(`UPDATE cortex_chat_sessions SET agent_config = ? WHERE session_id = ?`)
    .run(JSON.stringify(agentConfig), sessionId);
  return result.changes > 0;
}

/** Marker the compaction summary pair carries so UIs can label it. */
export const COMPACTED_USER_MARKER = "[Earlier conversation compacted]";

/** All rows of a session in order, id + role + content only (cheap history walks). */
function turnRefs(db: Database, sessionId: string): Array<{ id: number; role: string; content: string }> {
  return db
    .prepare(`SELECT id, role, content FROM cortex_chat_turns WHERE session_id = ? ORDER BY id ASC`)
    .all(sessionId) as Array<{ id: number; role: string; content: string }>;
}

/**
 * Replace the text of a compaction summary. Only the assistant row directly after a
 * compaction marker qualifies, so this can never rewrite an ordinary answer.
 */
export function editCompactionSummary(db: Database, sessionId: string, turnId: number, content: string): boolean {
  const rows = turnRefs(db, sessionId);
  const i = rows.findIndex((r) => r.id === turnId);
  const isSummary = i > 0 && rows[i]!.role === "assistant" && rows[i - 1]!.role === "user" && rows[i - 1]!.content === COMPACTED_USER_MARKER;
  if (!isSummary) return false;
  return db.prepare(`UPDATE cortex_chat_turns SET content = ? WHERE id = ?`).run(content, turnId).changes > 0;
}

/**
 * Rewind: delete the exchange that `turnId` belongs to and everything after it.
 * An assistant turn id rewinds to the user turn that prompted it. Returns the
 * removed user message (for edit / rerun) or `undefined` if the turn is unknown.
 */
export function rewindChatTurns(
  db: Database,
  sessionId: string,
  turnId: number,
): { removed: number; userMessage: string } | undefined {
  const rows = turnRefs(db, sessionId);
  const idx = rows.findIndex((r) => r.id === turnId);
  if (idx < 0) return undefined;
  let start = idx;
  while (start > 0 && rows[start]!.role !== "user") start--;
  const userMessage = rows[start]!.role === "user" ? rows[start]!.content : "";
  const cutoff = rows[start]!.id;
  const res = db.prepare(`DELETE FROM cortex_chat_turns WHERE session_id = ? AND id >= ?`).run(sessionId, cutoff);
  return { removed: res.changes, userMessage };
}

/** Clear context: delete every turn, keep the session and its config. */
export function rotateStableAgentId(db: Database, sessionId: string, agentId: string): void {
  db.prepare(`UPDATE cortex_chat_sessions SET stable_agent_id = ? WHERE session_id = ?`).run(agentId, sessionId);
}

/** Delete every turn of a session. */
export function clearChatTurns(db: Database, sessionId: string): number {
  return db.prepare(`DELETE FROM cortex_chat_turns WHERE session_id = ?`).run(sessionId).changes;
}

/**
 * Copy turns (with their stored tool/thinking trace) from one session to another.
 * `uptoTurnId` is inclusive; when it lands on a user turn its assistant reply is
 * included too so a fork never ends mid-exchange. Omit to copy everything.
 */
export function copyChatTurns(db: Database, fromSessionId: string, toSessionId: string, uptoTurnId?: number): number {
  const rows = turnRefs(db, fromSessionId);
  let end = rows.length;
  if (uptoTurnId !== undefined) {
    const idx = rows.findIndex((r) => r.id === uptoTurnId);
    if (idx < 0) return 0;
    end = idx + 1;
    if (rows[idx]!.role === "user" && rows[idx + 1]?.role === "assistant") end = idx + 2;
  }
  const ids = rows.slice(0, end).map((r) => r.id);
  const insert = db.prepare(
    `INSERT INTO cortex_chat_turns (session_id, role, content, tokens_used, tools_json, trace_json, provider, model, ts)
     SELECT ?, role, content, tokens_used, tools_json, trace_json, provider, model, ts FROM cortex_chat_turns WHERE id = ?`,
  );
  for (const id of ids) insert.run(toSessionId, id);
  return ids.length;
}

/** Number of user exchanges in a session. */
export function countChatExchanges(db: Database, sessionId: string): number {
  return turnRefs(db, sessionId).filter((r) => r.role === "user").length;
}

/**
 * Rows `compactChatTurns` would summarise: everything before the last `keepLast`
 * exchanges. Empty when there is nothing worth compacting.
 */
export function compactableTurns(
  db: Database,
  sessionId: string,
  keepLast: number,
): Array<{ id: number; role: string; content: string }> {
  const rows = turnRefs(db, sessionId);
  const userIdx = rows.flatMap((r, i) => (r.role === "user" ? [i] : []));
  if (userIdx.length <= keepLast) return [];
  const boundary = keepLast === 0 ? rows.length : userIdx[userIdx.length - keepLast]!;
  const old = rows.slice(0, boundary);
  // A prefix that is only a previous compaction summary is already compact.
  if (old.length <= 2 && old[0]?.content === COMPACTED_USER_MARKER) return [];
  return old.length >= 2 ? old : [];
}

/**
 * Compact: collapse the compactable prefix into ONE summary exchange, in place
 * (the first two old rows are overwritten so ids stay ordered ahead of the kept
 * tail). Returns how many rows were collapsed away.
 */
export function compactChatTurns(db: Database, sessionId: string, keepLast: number, summary: string): number {
  const old = compactableTurns(db, sessionId, keepLast);
  if (old.length === 0) return 0;
  const [first, second, ...rest] = old;
  db.transaction(() => {
    db.prepare(`UPDATE cortex_chat_turns SET role = 'user', content = ?, tokens_used = 0, tools_json = NULL, trace_json = NULL, provider = NULL, model = NULL WHERE id = ?`).run(
      COMPACTED_USER_MARKER,
      first!.id,
    );
    db.prepare(`UPDATE cortex_chat_turns SET role = 'assistant', content = ?, tokens_used = 0, tools_json = NULL, trace_json = NULL, provider = NULL, model = NULL WHERE id = ?`).run(
      summary,
      second!.id,
    );
    for (const r of rest) db.prepare(`DELETE FROM cortex_chat_turns WHERE id = ?`).run(r.id);
  })();
  return old.length - 2;
}
