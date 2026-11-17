import type { Plan, PlanFinding } from "@reactive-agents/core";
import { extrasOfStored, type PlanExtras } from "../services/chat-plan-extras.js";
import { findingsOfStored } from "../services/chat-plan-findings.js";
import { getChatTodo, type setChatTodo, type StoredTodoItem } from "./chat-queries.js";

type Db = Parameters<typeof setChatTodo>[0];

/**
 * What a session's plan holds beside its to-do list. The list is the plan's steps, statuses, tool
 * hints and origin (the framework's own seed row); a list row carries no plan id, goal or author.
 * Stored as JSON in `cortex_chat_sessions.plan_meta_json`.
 */
export interface StoredPlanMeta {
  readonly id: string;
  readonly goal: string;
  readonly source: Plan["source"];
  readonly createdAt: number;
  /**
   * Tool hint per step id, as older rows stored them before the to-do row carried the hint. Read
   * only (see {@link getChatTodoWithHints}); never written again.
   */
  readonly tools: Readonly<Record<string, string>>;
  /** Recon findings the plan carries (`Plan.findings`); absent when it has none. */
  readonly findings?: readonly PlanFinding[];
  /** Prerequisite step ids per step id (`PlanStep.dependsOn`); the to-do row cannot carry them. Absent when none. */
  readonly dependsOn?: PlanExtras["dependsOn"];
  /** Tool arguments per step id (`PlanStep.args`); absent when none. */
  readonly args?: PlanExtras["args"];
}

/** The step extras a stored meta holds (none for no meta). */
export const extrasOfMeta = (meta: StoredPlanMeta | null): PlanExtras => ({ dependsOn: meta?.dependsOn ?? {}, args: meta?.args ?? {} });

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
    const findings = findingsOfStored(raw.findings);
    const extras = extrasOfStored(raw.dependsOn, raw.args);
    return {
      id: raw.id,
      goal: raw.goal,
      source: raw.source as Plan["source"],
      createdAt: raw.createdAt,
      tools,
      ...(findings.length > 0 ? { findings } : {}),
      ...(Object.keys(extras.dependsOn).length > 0 ? { dependsOn: extras.dependsOn } : {}),
      ...(Object.keys(extras.args).length > 0 ? { args: extras.args } : {}),
    };
  } catch {
    return null;
  }
}

/** Store (or, with `null`, clear) the session's plan meta. Tool hints ride the to-do rows, not the meta. */
export function setChatPlanMeta(db: Db, sessionId: string, meta: Omit<StoredPlanMeta, "tools"> | null): void {
  db.prepare(`UPDATE cortex_chat_sessions SET plan_meta_json = ? WHERE session_id = ?`).run(
    meta === null ? null : JSON.stringify(meta),
    sessionId,
  );
}

/** A to-do list with each row that lost its hint given the one an older row kept in the meta. Pure. */
export function withLegacyTools(todo: readonly StoredTodoItem[], meta: StoredPlanMeta | null): StoredTodoItem[] {
  if (meta === null) return [...todo];
  return todo.map((i) => {
    const legacy = meta.tools[i.id];
    return i.tool === undefined && legacy !== undefined ? { ...i, tool: legacy } : i;
  });
}

/**
 * The session's persisted to-do list, tool hints included. A row written before the list carried
 * hints gets the one its plan meta held, so a plan survives the move without a data migration.
 */
export function getChatTodoWithHints(db: Db, sessionId: string): StoredTodoItem[] {
  return withLegacyTools(getChatTodo(db, sessionId), getChatPlanMeta(db, sessionId));
}
