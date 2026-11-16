import type { Plan } from "@reactive-agents/core";
import type { setChatTodo } from "./chat-queries.js";

type Db = Parameters<typeof setChatTodo>[0];

/**
 * What a session's plan holds beside its to-do list. The list is the plan's steps and statuses;
 * a list row carries no plan id, goal, author or tool hint. Stored as JSON in
 * `cortex_chat_sessions.plan_meta_json`.
 */
export interface StoredPlanMeta {
  readonly id: string;
  readonly goal: string;
  readonly source: Plan["source"];
  readonly createdAt: number;
  /** Tool hint per step id. */
  readonly tools: Readonly<Record<string, string>>;
}

const SOURCES: ReadonlySet<string> = new Set(["model", "harness-derived", "user-edited"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The session's stored plan meta; `null` for none, a legacy row or a corrupt value. */
export function getChatPlanMeta(db: Db, sessionId: string): StoredPlanMeta | null {
  const row = db.prepare(`SELECT plan_meta_json FROM cortex_chat_sessions WHERE session_id = ?`).get(sessionId) as
    | { plan_meta_json: string | null }
    | undefined;
  if (!row?.plan_meta_json) return null;
  try {
    const raw: unknown = JSON.parse(row.plan_meta_json);
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.goal !== "string" || typeof raw.createdAt !== "number") return null;
    if (typeof raw.source !== "string" || !SOURCES.has(raw.source)) return null;
    const tools = isRecord(raw.tools)
      ? Object.fromEntries(Object.entries(raw.tools).filter((e): e is [string, string] => typeof e[1] === "string"))
      : {};
    return { id: raw.id, goal: raw.goal, source: raw.source as Plan["source"], createdAt: raw.createdAt, tools };
  } catch {
    return null;
  }
}

/** Store (or, with `null`, clear) the session's plan meta. */
export function setChatPlanMeta(db: Db, sessionId: string, meta: StoredPlanMeta | null): void {
  db.prepare(`UPDATE cortex_chat_sessions SET plan_meta_json = ? WHERE session_id = ?`).run(
    meta === null ? null : JSON.stringify(meta),
    sessionId,
  );
}
