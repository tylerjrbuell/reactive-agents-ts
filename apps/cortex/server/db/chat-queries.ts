import type { Database } from "bun:sqlite";
import { generateTaskId } from "@reactive-agents/core";
import { runNotesFromStorage, strategyRunFromStorage } from "@reactive-agents/ui-core";
import { readStoredAttachments, readStoredDeliverables, readStoredOutcome, type StoredTurnTrace } from "../services/chat-turn-trace.js";
import { migrateLegacyCliToolsInConfig } from "../services/legacy-cli-tools.js";

/**
 * How full the model's context window was on a turn's last LLM call. The window
 * fields are absent for a compaction estimate when the window size is unknown.
 */
export type StoredContext = {
  tokensUsed: number;
  windowTokens?: number;
  utilizationPct?: number;
  level?: "low" | "medium" | "high" | "critical";
  /** Set on compaction estimates (computed from text, not reported by the provider). */
  estimated?: boolean;
};

const CONTEXT_LEVELS = ["low", "medium", "high", "critical"];

function parseStoredContext(raw: string | null): StoredContext | undefined {
  if (!raw) return undefined;
  try {
    const p = JSON.parse(raw) as Partial<StoredContext>;
    if (typeof p.tokensUsed !== "number") return undefined;
    const out: StoredContext = { tokensUsed: p.tokensUsed };
    if (typeof p.windowTokens === "number") out.windowTokens = p.windowTokens;
    if (typeof p.utilizationPct === "number") out.utilizationPct = p.utilizationPct;
    if (typeof p.level === "string" && CONTEXT_LEVELS.includes(p.level)) out.level = p.level as NonNullable<StoredContext["level"]>;
    if (p.estimated === true) out.estimated = true;
    // A reading must say how full it is or carry tokens alone; a half-window reading is corrupt.
    if ((out.windowTokens === undefined) !== (out.utilizationPct === undefined)) return undefined;
    return out;
  } catch {
    /* ignore a corrupt reading */
  }
  return undefined;
}

export type ChatSessionRow = {
  sessionId: string;
  name: string;
  agentConfig: Record<string, unknown>;
  createdAt: number;
  lastUsedAt: number;
  /** Stable agentId generated at session creation for persistent memory. */
  stableAgentId?: string;
  /** Session mode: `plan` = reasoning only, no tools, until switched to `execute`. */
  mode: "plan" | "execute";
};

export type ChatTurnRow = {
  id: number;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  tokensUsed: number;
  /** Provider-reported prompt tokens; absent when the provider/run did not split. */
  tokensIn?: number;
  /** Provider-reported completion tokens; absent when the provider/run did not split. */
  tokensOut?: number;
  /** Tool names from the tool-capable chat path (assistant turns only). */
  toolsUsed?: string[];
  /** Thinking + per-call tool detail so a reloaded chat can show what happened (assistant turns only). */
  trace?: StoredTurnTrace;
  /** Provider / model that produced the turn (assistant turns persisted after this was tracked). */
  provider?: string;
  model?: string;
  /** Context-window reading at the end of the turn's run, so the usage ring survives reload. */
  context?: StoredContext;
  /** Spend of this turn in USD (0 for user turns and pre-migration rows). */
  costUsd: number;
  /** `false` when the cost is unpriced or only a lower bound. */
  costKnown: boolean;
  /** Framework run id (names the run's JSONL trace file); absent for older or untraced turns. */
  runId?: string;
  /** The run this turn's run continues (a Continue's new run); lifted from the stored trace. Absent for an ordinary turn and older rows. */
  continuedFrom?: string;
  /** True when the turn stopped before completion (user cancel / mid-stream error) but spent tokens. */
  incomplete?: boolean;
  ts: number;
};

/** Session-level totals, summed in SQL (the one source the UI reads). */
export type ChatSessionTotals = {
  tokens: number;
  /** Sum of provider-reported prompt tokens (0 when nothing was reported). */
  tokensIn: number;
  tokensOut: number;
  /** True when every assistant turn with tokens reported both halves. */
  splitComplete: boolean;
  costUsd: number;
  costKnown: boolean;
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
      `SELECT session_id, name, agent_config, stable_agent_id, mode, created_at, last_used_at
       FROM cortex_chat_sessions WHERE session_id = ?`,
    )
    .get(sessionId) as
    | {
        session_id: string;
        name: string;
        agent_config: string;
        stable_agent_id: string | null;
        mode: string | null;
        created_at: number;
        last_used_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    name: row.name,
    agentConfig: migrateLegacyCliToolsInConfig(JSON.parse(row.agent_config) as Record<string, unknown>),
    ...(row.stable_agent_id ? { stableAgentId: row.stable_agent_id } : {}),
    mode: row.mode === "plan" ? "plan" : "execute",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/** Persist the session's mode (`plan` | `execute`). False when the session does not exist. */
export function setChatMode(db: Database, sessionId: string, mode: "plan" | "execute"): boolean {
  return db.prepare(`UPDATE cortex_chat_sessions SET mode = ? WHERE session_id = ?`).run(mode, sessionId).changes > 0;
}

export function listChatSessions(db: Database): ChatSessionRow[] {
  const rows = db
    .prepare(
      `SELECT session_id, name, agent_config, stable_agent_id, mode, created_at, last_used_at
       FROM cortex_chat_sessions ORDER BY last_used_at DESC LIMIT 100`,
    )
    .all() as Array<{
    session_id: string;
    name: string;
    agent_config: string;
    stable_agent_id: string | null;
    mode: string | null;
    created_at: number;
    last_used_at: number;
  }>;
  return rows.map((r) => ({
    sessionId: r.session_id,
    name: r.name,
    agentConfig: migrateLegacyCliToolsInConfig(JSON.parse(r.agent_config) as Record<string, unknown>),
    ...(r.stable_agent_id ? { stableAgentId: r.stable_agent_id } : {}),
    mode: r.mode === "plan" ? ("plan" as const) : ("execute" as const),
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
    /** Provider-reported split, when one exists. Omit rather than deriving. */
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    toolsUsed?: readonly string[];
    trace?: StoredTurnTrace;
    provider?: string;
    model?: string;
    costUsd?: number;
    costKnown?: boolean;
    runId?: string;
    context?: StoredContext;
    /** Cancelled / errored turn whose spend and partial reply are still recorded. */
    incomplete?: boolean;
  },
): void {
  const traceJson = turn.trace ? JSON.stringify(turn.trace) : null;
  const toolsJson =
    turn.toolsUsed && turn.toolsUsed.length > 0 ? JSON.stringify([...turn.toolsUsed]) : null;
  db.prepare(
    `INSERT INTO cortex_chat_turns (session_id, role, content, tokens_used, tokens_in, tokens_out, tools_json, trace_json, provider, model, cost_usd, cost_known, run_id, context_json, incomplete, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    turn.sessionId,
    turn.role,
    turn.content,
    turn.tokensUsed,
    turn.inputTokens ?? null,
    turn.outputTokens ?? null,
    toolsJson,
    traceJson,
    turn.provider ?? null,
    turn.model ?? null,
    turn.costUsd ?? 0,
    turn.costKnown === false ? 0 : 1,
    turn.runId ?? null,
    turn.context ? JSON.stringify(turn.context) : null,
    turn.incomplete === true ? 1 : 0,
    Date.now(),
  );
}

export function getChatTurns(db: Database, sessionId: string): ChatTurnRow[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, role, content, tokens_used, tokens_in, tokens_out, tools_json, trace_json, provider, model, cost_usd, cost_known, run_id, context_json, incomplete, ts FROM cortex_chat_turns WHERE session_id = ? ORDER BY id ASC`,
    )
    .all(sessionId) as Array<{
    id: number;
    session_id: string;
    role: string;
    content: string;
    tokens_used: number;
    tokens_in: number | null;
    tokens_out: number | null;
    tools_json: string | null;
    trace_json: string | null;
    provider: string | null;
    model: string | null;
    cost_usd: number;
    cost_known: number;
    run_id: string | null;
    context_json: string | null;
    incomplete: number;
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
          const checklist = parsed.checklist;
          const outcome = readStoredOutcome(parsed.outcome);
          const deliverables = readStoredDeliverables(parsed.deliverables);
          const attachments = readStoredAttachments(parsed.attachments);
          const strategyRun = strategyRunFromStorage(parsed.strategyRun);
          const runNotes = runNotesFromStorage(parsed.runNotes);
          trace = {
            reasoningSteps: parsed.reasoningSteps,
            toolCalls: parsed.toolCalls,
            // Optional fields written by the ui-core fold; keep them across reload (a whitelist here dropped them).
            ...(checklist && typeof checklist === "object" && "root" in checklist ? { checklist } : {}),
            ...(Array.isArray(parsed.subAgents) && parsed.subAgents.length > 0 ? { subAgents: parsed.subAgents } : {}),
            ...(parsed.usage && Array.isArray(parsed.usage.calls) && parsed.usage.calls.length > 0
              ? { usage: parsed.usage }
              : {}),
            ...(parsed.context && typeof parsed.context.windowTokens === "number" ? { context: parsed.context } : {}),
            ...(outcome ? { outcome } : {}),
            ...(deliverables ? { deliverables } : {}),
            // Reported by the run (StreamCompleted.metadata): the chat action row's strategy chip and "Ran 42s".
            ...(typeof parsed.strategy === "string" && parsed.strategy !== "" ? { strategy: parsed.strategy } : {}),
            ...(typeof parsed.durationMs === "number" && parsed.durationMs >= 0 ? { durationMs: parsed.durationMs } : {}),
            // Skills the run had active and why (chat-turn-skills.ts).
            ...(parsed.skills && Array.isArray(parsed.skills.activations) ? { skills: parsed.skills } : {}),
            // Memories the run recalled (chat-turn-recall.ts); [] = reported, recalled nothing.
            ...(Array.isArray(parsed.recalled) ? { recalled: parsed.recalled } : {}),
            // What the user attached to this (user) message: names and sizes only (chat-attachments.ts).
            ...(attachments ? { attachments } : {}),
            ...(typeof parsed.continuedFrom === "string" && parsed.continuedFrom !== "" ? { continuedFrom: parsed.continuedFrom } : {}),
            // The strategy card's folded phases (chat-turn-trace.ts); absent on older rows.
            ...(strategyRun ? { strategyRun } : {}),
            // How the run ended beyond success or failure: to-do outcome, unread-results note, authority (ui-core run-notes).
            ...(runNotes ? { runNotes } : {}),
          };
        }
      } catch {
        /* ignore a corrupt trace — the turn still renders from content */
      }
    }
    const context = parseStoredContext(r.context_json);
    return {
      id: r.id,
      sessionId: r.session_id,
      role: r.role as "user" | "assistant",
      content: r.content,
      tokensUsed: r.tokens_used,
      ...(typeof r.tokens_in === "number" ? { tokensIn: r.tokens_in } : {}),
      ...(typeof r.tokens_out === "number" ? { tokensOut: r.tokens_out } : {}),
      ...(toolsUsed && toolsUsed.length > 0 ? { toolsUsed } : {}),
      ...(trace ? { trace } : {}),
      ...(r.provider ? { provider: r.provider } : {}),
      ...(r.model ? { model: r.model } : {}),
      costUsd: r.cost_usd,
      costKnown: r.cost_known !== 0,
      ...(r.run_id ? { runId: r.run_id } : {}),
      ...(trace?.continuedFrom ? { continuedFrom: trace.continuedFrom } : {}),
      ...(context ? { context } : {}),
      incomplete: r.incomplete !== 0,
      ts: r.ts,
    };
  });
}

/** Tokens and cost across a session's turns; `costKnown` is false if any turn is unpriced or a lower bound. */
export function getChatSessionTotals(db: Database, sessionId: string): ChatSessionTotals {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(tokens_used), 0) AS tokens,
              COALESCE(SUM(tokens_in), 0) AS tokens_in,
              COALESCE(SUM(tokens_out), 0) AS tokens_out,
              COALESCE(SUM(CASE WHEN role = 'assistant' AND tokens_used > 0
                                AND (tokens_in IS NULL OR tokens_out IS NULL) THEN 1 ELSE 0 END), 0) AS incomplete_splits,
              COALESCE(SUM(cost_usd), 0) AS cost,
              COALESCE(MIN(cost_known), 1) AS known
       FROM cortex_chat_turns WHERE session_id = ?`,
    )
    .get(sessionId) as {
    tokens: number;
    tokens_in: number;
    tokens_out: number;
    incomplete_splits: number;
    cost: number;
    known: number;
  };
  return {
    tokens: r.tokens,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    splitComplete: r.incomplete_splits === 0,
    costUsd: r.cost,
    costKnown: r.known !== 0,
  };
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
): { removed: number; userMessage: string; /** `ts` of the last surviving row (0 when none): session records made after it (proposals) belonged to the removed turns. */ afterTs: number } | undefined {
  const rows = turnRefs(db, sessionId);
  const idx = rows.findIndex((r) => r.id === turnId);
  if (idx < 0) return undefined;
  let start = idx;
  while (start > 0 && rows[start]!.role !== "user") start--;
  const userMessage = rows[start]!.role === "user" ? rows[start]!.content : "";
  const cutoff = rows[start]!.id;
  // A turn's rows are written when it ends, so a proposal made DURING a removed turn predates that
  // turn's own row: the boundary is the last row that survives.
  const prev = db
    .prepare(`SELECT MAX(ts) AS ts FROM cortex_chat_turns WHERE session_id = ? AND id < ?`)
    .get(sessionId, cutoff) as { ts: number | null };
  const res = db.prepare(`DELETE FROM cortex_chat_turns WHERE session_id = ? AND id >= ?`).run(sessionId, cutoff);
  return { removed: res.changes, userMessage, afterTs: prev.ts ?? 0 };
}

/** One persisted to-do row (the conversation-level list; mirrors the runtime's `TodoSeedItem`). */
export type StoredTodoItem = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
  /** Tool the step names (a plan step's hint). Absent = none. */
  tool?: string;
  /** `"harness-derived"` when the harness derived the row from the model's reply. */
  origin?: "harness-derived";
};

const TODO_STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "completed"]);

/** The conversation's persisted to-do list; empty for legacy rows (NULL) or a corrupt value. */
export function getChatTodo(db: Database, sessionId: string): StoredTodoItem[] {
  const row = db.prepare(`SELECT todo_json FROM cortex_chat_sessions WHERE session_id = ?`).get(sessionId) as
    | { todo_json: string | null }
    | undefined;
  if (!row?.todo_json) return [];
  try {
    const raw: unknown = JSON.parse(row.todo_json);
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((r): StoredTodoItem[] => {
      const o = r as Partial<StoredTodoItem> | null;
      return o && typeof o.id === "string" && typeof o.title === "string" && typeof o.status === "string" && TODO_STATUSES.has(o.status)
        ? [
            {
              id: o.id,
              title: o.title,
              status: o.status as StoredTodoItem["status"],
              ...(typeof o.tool === "string" && o.tool !== "" ? { tool: o.tool } : {}),
              ...(o.origin === "harness-derived" ? { origin: o.origin } : {}),
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}

/** Replace the conversation's to-do list (empty list stores NULL). */
export function setChatTodo(db: Database, sessionId: string, items: readonly StoredTodoItem[]): void {
  db.prepare(`UPDATE cortex_chat_sessions SET todo_json = ? WHERE session_id = ?`).run(
    items.length > 0 ? JSON.stringify(items) : null,
    sessionId,
  );
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
    `INSERT INTO cortex_chat_turns (session_id, role, content, tokens_used, tokens_in, tokens_out, tools_json, trace_json, provider, model, cost_usd, cost_known, run_id, context_json, incomplete, ts)
     SELECT ?, role, content, tokens_used, tokens_in, tokens_out, tools_json, trace_json, provider, model, cost_usd, cost_known, run_id, context_json, incomplete, ts FROM cortex_chat_turns WHERE id = ?`,
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
 * tail). The summary row carries the collapsed rows' summed tokens/cost (and ANDed
 * `cost_known`) so `getChatSessionTotals` is unchanged. Returns how many rows were collapsed away.
 *
 * `context` is the estimate for the transcript the next turn sees. It goes on the summary
 * row, and readings on the kept rows are cleared: they describe history from before the
 * compaction, so the newest reading must be the estimate.
 */
export function compactChatTurns(
  db: Database,
  sessionId: string,
  keepLast: number,
  summary: string,
  context?: StoredContext,
): number {
  const old = compactableTurns(db, sessionId, keepLast);
  if (old.length === 0) return 0;
  const [first, second, ...rest] = old;
  db.transaction(() => {
    // The summary row inherits the collapsed rows' spend so session totals stay constant.
    const marks = old.map(() => "?").join(",");
    const spent = db
      .prepare(
        `SELECT COALESCE(SUM(tokens_used), 0) AS tokens, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(MIN(cost_known), 1) AS known FROM cortex_chat_turns WHERE id IN (${marks})`,
      )
      .get(...old.map((r) => r.id)) as { tokens: number; cost: number; known: number };
    db.prepare(`UPDATE cortex_chat_turns SET role = 'user', content = ?, tokens_used = 0, tokens_in = NULL, tokens_out = NULL, tools_json = NULL, trace_json = NULL, provider = NULL, model = NULL, cost_usd = 0, cost_known = 1, run_id = NULL WHERE id = ?`).run(
      COMPACTED_USER_MARKER,
      first!.id,
    );
    db.prepare(`UPDATE cortex_chat_turns SET role = 'assistant', content = ?, tokens_used = 0, tokens_in = NULL, tokens_out = NULL, tools_json = NULL, trace_json = NULL, provider = NULL, model = NULL, cost_usd = 0, cost_known = 1, run_id = NULL WHERE id = ?`).run(
      summary,
      second!.id,
    );
    db.prepare(`UPDATE cortex_chat_turns SET tokens_used = ?, cost_usd = ?, cost_known = ?, context_json = ? WHERE id = ?`).run(
      spent.tokens,
      spent.cost,
      spent.known !== 0 ? 1 : 0,
      context ? JSON.stringify(context) : null,
      second!.id,
    );
    for (const r of rest) db.prepare(`DELETE FROM cortex_chat_turns WHERE id = ?`).run(r.id);
    // Every row after the summary is a kept row; its reading predates the compaction.
    db.prepare(`UPDATE cortex_chat_turns SET context_json = NULL WHERE session_id = ? AND id > ?`).run(sessionId, second!.id);
  })();
  return old.length - 2;
}

/**
 * The transcript the next turn sees once `compactChatTurns` runs with the same
 * `keepLast`: the compaction marker, the summary, then every kept row. Read before the
 * compaction is applied, so the estimate can be computed under the same guard.
 */
export function compactedTranscript(
  db: Database,
  sessionId: string,
  keepLast: number,
  summary: string,
): Array<{ role: string; content: string }> {
  const rows = turnRefs(db, sessionId);
  const old = compactableTurns(db, sessionId, keepLast);
  if (old.length === 0) return rows;
  return [
    { role: "user", content: COMPACTED_USER_MARKER },
    { role: "assistant", content: summary },
    ...rows.slice(old.length),
  ];
}

/**
 * The newest reading on the session that knows its window size. Used as the window for
 * a compaction estimate, because the window is a property of the model, not the turn.
 */
export function latestWindowedContext(db: Database, sessionId: string): StoredContext | undefined {
  const rows = db
    .prepare(`SELECT context_json FROM cortex_chat_turns WHERE session_id = ? AND context_json IS NOT NULL ORDER BY id DESC`)
    .all(sessionId) as Array<{ context_json: string | null }>;
  for (const r of rows) {
    const c = parseStoredContext(r.context_json);
    if (c?.windowTokens !== undefined) return c;
  }
  return undefined;
}
