import type { Database } from "bun:sqlite";
import { generateTaskId } from "@reactive-agents/core";

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
  },
): void {
  const toolsJson =
    turn.toolsUsed && turn.toolsUsed.length > 0 ? JSON.stringify([...turn.toolsUsed]) : null;
  db.prepare(
    `INSERT INTO cortex_chat_turns (session_id, role, content, tokens_used, tools_json, ts) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(turn.sessionId, turn.role, turn.content, turn.tokensUsed, toolsJson, Date.now());
}

export function getChatTurns(db: Database, sessionId: string): ChatTurnRow[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, role, content, tokens_used, tools_json, ts FROM cortex_chat_turns WHERE session_id = ? ORDER BY id ASC`,
    )
    .all(sessionId) as Array<{
    id: number;
    session_id: string;
    role: string;
    content: string;
    tokens_used: number;
    tools_json: string | null;
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
    return {
      id: r.id,
      sessionId: r.session_id,
      role: r.role as "user" | "assistant",
      content: r.content,
      tokensUsed: r.tokens_used,
      ...(toolsUsed && toolsUsed.length > 0 ? { toolsUsed } : {}),
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
