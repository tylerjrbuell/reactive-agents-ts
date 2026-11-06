import { CORTEX_SERVER_URL } from "$lib/constants.js";

/**
 * A chat turn paused on a durable approval gate (server `chat-approvals.ts`). Its user
 * message is not in the thread's turns until Approve / Deny lands the reply.
 */
export interface ChatPendingApprovalWire {
  readonly runId: string;
  readonly sessionId: string;
  readonly userMessage: string;
  readonly gateId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly createdAt: number;
}

/** What the user can do with a paused turn. */
export type ApprovalVerb = "approve" | "deny" | "dismiss";

/** Server answer to a decision: the run finished, paused again on another gate, or failed. */
export type ApprovalDecisionResult =
  | { readonly ok: true; readonly status: "completed" | "awaiting-approval" | "dismissed" }
  | { readonly ok: false; readonly status: number; readonly error: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_ARG_CHARS = 160;

/** One `key: value` row per top-level argument, values truncated so a long file body stays one line. */
export function approvalArgRows(args: unknown): { key: string; value: string }[] {
  const clip = (s: string) => (s.length > MAX_ARG_CHARS ? `${s.slice(0, MAX_ARG_CHARS)}…` : s);
  const show = (v: unknown): string => {
    if (typeof v === "string") return clip(v.replace(/\s+/g, " "));
    try {
      return clip(JSON.stringify(v) ?? String(v));
    } catch {
      return clip(String(v));
    }
  };
  if (args !== null && typeof args === "object" && !Array.isArray(args)) {
    return Object.entries(args as Record<string, unknown>).map(([key, value]) => ({ key, value: show(value) }));
  }
  return args === null || args === undefined ? [] : [{ key: "args", value: show(args) }];
}

/** POST a decision for a paused chat turn. Never throws; network errors come back as `ok: false`. */
export async function decideChatApproval(
  sessionId: string,
  runId: string,
  verb: ApprovalVerb,
  reason?: string,
  fetchFn: Fetch = (url, init) => fetch(url, init),
): Promise<ApprovalDecisionResult> {
  const url = `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(runId)}/${verb}`;
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reason?.trim() ? { reason: reason.trim() } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
    if (!res.ok) return { ok: false, status: res.status, error: body.error ?? `Request failed (${res.status})` };
    if (verb === "dismiss") return { ok: true, status: "dismissed" };
    return { ok: true, status: body.status === "awaiting-approval" ? "awaiting-approval" : "completed" };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
