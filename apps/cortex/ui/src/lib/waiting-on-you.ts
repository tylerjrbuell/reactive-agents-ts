/**
 * The Runs page's "Waiting on you" strip (Bench spec section 8): durable runs
 * paused on an approval gate (`GET /api/runs/pending-approvals`) and on a
 * `request_user_input` question (`GET /api/runs/pending-interactions`), as one
 * list. The strip only renders when the list is non-empty. Pure.
 */
import type { PendingInteractionWire } from "@reactive-agents/ui-core";
import { RUN_SOURCE_LABEL, runNameOf, runSourceOf, type RunRow } from "./runs-table.js";

/** One row of `GET /api/runs/pending-approvals`. `chatSessionId` is set for chat turns. */
export interface PendingApprovalWire {
  readonly runId: string;
  readonly agentId: string;
  readonly gateId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly chatSessionId?: string;
}

/** One item waiting on the user. */
export type WaitingItem =
  | {
      readonly kind: "approval";
      readonly key: string;
      readonly runId: string;
      readonly toolName: string;
      /** The call's arguments, short (`rm -rf build/` for a shell command). */
      readonly detail: string;
      /** Run name and source, when the run is in the list. */
      readonly context: string;
      readonly chatSessionId?: string;
      /** The Cortex run to open (`/run/:id`), when it is in the list. */
      readonly openRunId?: string;
    }
  | {
      readonly kind: "question";
      readonly key: string;
      readonly runId: string;
      readonly interaction: PendingInteractionWire;
      readonly context: string;
      readonly openRunId?: string;
    };

const MAX_DETAIL = 120;

const clip = (s: string): string => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL - 1)}…` : s);

/** Argument keys whose value names the call on its own (a command, a path, a URL). */
const HEADLINE_KEYS = ["command", "cmd", "path", "url", "query", "file", "name"] as const;

/**
 * A short form of a gated call's arguments: the command, path or URL when one
 * field says it, else compact JSON, clipped to 120 characters.
 */
export function approvalDetail(args: unknown): string {
  if (typeof args === "string") return clip(args);
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const rec = args as Record<string, unknown>;
    for (const k of HEADLINE_KEYS) {
      const v = rec[k];
      if (typeof v === "string" && v.trim()) return clip(v.trim());
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) return clip(v.join(" "));
    }
  }
  try {
    return clip(JSON.stringify(args) ?? "");
  } catch {
    return "";
  }
}

function contextOf(run: RunRow | undefined, chatSessionId: string | undefined): string {
  if (run) return `${runNameOf(run)} · ${RUN_SOURCE_LABEL[runSourceOf(run)]}`;
  return chatSessionId ? "chat" : "";
}

/** Approvals first, then questions, each in the order the server listed them. */
export function waitingItemsOf(
  approvals: readonly PendingApprovalWire[],
  interactions: readonly PendingInteractionWire[],
  runs: readonly RunRow[],
): readonly WaitingItem[] {
  const byId = new Map(runs.map((r) => [r.runId, r]));
  // A desk or gateway approval carries the DURABLE run id, not the Cortex run id;
  // its agent id is the Cortex agent's, so fall back to that agent's newest run.
  const latestByAgent = new Map<string, RunRow>();
  for (const r of runs) {
    const prev = latestByAgent.get(r.agentId);
    if (!prev || r.startedAt > prev.startedAt) latestByAgent.set(r.agentId, r);
  }
  const out: WaitingItem[] = [];
  for (const a of approvals) {
    const run = byId.get(a.runId) ?? (a.chatSessionId ? undefined : latestByAgent.get(a.agentId));
    out.push({
      kind: "approval",
      key: `a:${a.runId}:${a.gateId}`,
      runId: a.runId,
      toolName: a.toolName || "Tool call",
      detail: approvalDetail(a.args),
      context: contextOf(run, a.chatSessionId),
      ...(a.chatSessionId ? { chatSessionId: a.chatSessionId } : {}),
      ...(run ? { openRunId: run.runId } : {}),
    });
  }
  for (const i of interactions) {
    const run = byId.get(i.runId);
    out.push({
      kind: "question",
      key: `q:${i.runId}:${i.interactionId}`,
      runId: i.runId,
      interaction: i,
      context: contextOf(run, undefined),
      ...(run ? { openRunId: run.runId } : {}),
    });
  }
  return out;
}

/** The options of a `choice` interaction (strings only). */
export function choiceOptions(schema: unknown): readonly string[] {
  if (!schema || typeof schema !== "object") return [];
  const options = (schema as { options?: unknown }).options;
  return Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : [];
}

/** One field of a `form` interaction. */
export interface WaitingFormField {
  readonly name: string;
  readonly label: string;
  readonly type: "text" | "number" | "boolean";
}

/** The fields of a `form` interaction. */
export function formFields(schema: unknown): readonly WaitingFormField[] {
  if (!schema || typeof schema !== "object") return [];
  const fields = (schema as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  const out: WaitingFormField[] = [];
  for (const f of fields) {
    if (!f || typeof f !== "object") continue;
    const { name, label, type } = f as { name?: unknown; label?: unknown; type?: unknown };
    if (typeof name !== "string") continue;
    out.push({ name, label: typeof label === "string" && label ? label : name, type: type === "number" || type === "boolean" ? type : "text" });
  }
  return out;
}
