/**
 * The Runs page's "Waiting on you" strip (Bench spec section 8): durable runs
 * paused on an approval gate (`GET /api/runs/pending-approvals`) and on a
 * `request_user_input` question (`GET /api/runs/pending-interactions`), as one
 * list. The strip only renders when the list is non-empty. Pure.
 */
import type { PendingInteractionWire } from "@reactive-agents/ui-core";
import { RUN_SOURCE_LABEL, runNameOf, runSourceOf, type RunRow } from "./runs-table.js";
import { redactSecrets } from "./run-error.js";

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

/** Redacted (credential-shaped tokens) and clipped to {@link MAX_DETAIL}. */
const clip = (raw: string): string => {
  const s = redactSecrets(raw);
  return s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL - 1)}…` : s;
};

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

/** The fields a run needs to be matched to an approval or a question. */
export interface WaitingRunRef {
  readonly runId: string;
  readonly agentId: string;
  /** Newest wins when an approval falls back to its agent or chat session. */
  readonly startedAt: number;
  readonly chatSessionId?: string;
  /** Sub-agent runs never take a parent's approval. */
  readonly parentRunId?: string;
}

/** What a waiting run waits for. */
export type WaitingFor =
  | { readonly kind: "approval"; readonly approval: PendingApprovalWire }
  | { readonly kind: "question"; readonly interaction: PendingInteractionWire };

/**
 * The runs that wait on the user, by Cortex run id. A question matches its run
 * id. A desk or gateway approval carries the DURABLE run id, so it falls back
 * to the newest root run of the same agent; a chat approval falls back to the
 * newest root run of its chat session. The first item per run wins. One
 * resolver for Beacon (`needsYouByRun`), Runs and the run view.
 */
export function waitingRunsOf<R extends WaitingRunRef>(
  runs: readonly R[],
  approvals: readonly PendingApprovalWire[],
  interactions: readonly PendingInteractionWire[],
): ReadonlyMap<string, WaitingFor> {
  const byId = new Map(runs.map((r) => [r.runId, r]));
  const newest = (match: (r: R) => boolean): R | undefined => {
    let best: R | undefined;
    for (const r of runs) {
      if (!match(r) || r.parentRunId) continue;
      if (!best || r.startedAt > best.startedAt) best = r;
    }
    return best;
  };
  const out = new Map<string, WaitingFor>();
  for (const a of approvals) {
    const run =
      byId.get(a.runId) ??
      (a.chatSessionId ? newest((r) => r.chatSessionId === a.chatSessionId) : newest((r) => r.agentId === a.agentId));
    if (!run || out.has(run.runId)) continue;
    out.set(run.runId, { kind: "approval", approval: a });
  }
  for (const i of interactions) {
    const run = byId.get(i.runId);
    if (!run || out.has(run.runId)) continue;
    out.set(run.runId, { kind: "question", interaction: i });
  }
  return out;
}

/** The approval a run waits on, as the run view header shows it. */
export interface RunApproval {
  /** The id the approve / deny endpoints take: the durable run id the approval carries (not the Cortex run id). */
  readonly approvalRunId: string;
  readonly toolName: string;
  /** The call in short (`git commit -m "…"`). */
  readonly detail: string;
}

/** The approval a run waits on (from {@link waitingRunsOf}); `undefined` when it waits on nothing or on a question. */
export function runApprovalOf(waiting: WaitingFor | undefined): RunApproval | undefined {
  if (waiting?.kind !== "approval") return undefined;
  const a = waiting.approval;
  return { approvalRunId: a.runId, toolName: a.toolName, detail: approvalDetail(a.args) };
}

/** Run statuses that mean the run is still going (the paused run publishes no terminal event). */
const STILL_GOING = new Set(["live", "streaming", "running"]);

/**
 * The status a run row shows: a run that is still going but waits on the user
 * reads `awaiting-approval` / `awaiting-interaction` (ui-core `statusOfRun`:
 * "Waiting on you"), not Running. A durable run paused at an approval gate
 * publishes no terminal event (runtime 835c4d1cd), so its stored status stays
 * `live`. Ended runs keep their status.
 */
export function waitingStatusOf(status: string, waiting: WaitingFor | undefined): string {
  if (!waiting || !STILL_GOING.has(status)) return status;
  return waiting.kind === "approval" ? "awaiting-approval" : "awaiting-interaction";
}

/** The rows with `waitingStatusOf` applied (same objects when nothing waits). */
export function withWaitingStatus<T extends WaitingRunRef & { readonly status: string }>(
  rows: readonly T[],
  waiting: ReadonlyMap<string, WaitingFor>,
): readonly T[] {
  if (waiting.size === 0) return rows;
  return rows.map((r) => {
    const status = waitingStatusOf(r.status, waiting.get(r.runId));
    return status === r.status ? r : { ...r, status };
  });
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
