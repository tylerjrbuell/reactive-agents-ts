import { CORTEX_SERVER_URL } from "$lib/constants.js";
import { redactSecrets } from "./run-error.js";

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
    if (typeof v === "string") return clip(redactSecrets(v.replace(/\s+/g, " ")));
    try {
      return clip(redactSecrets(JSON.stringify(v) ?? String(v)));
    } catch {
      return clip(redactSecrets(String(v)));
    }
  };
  if (args !== null && typeof args === "object" && !Array.isArray(args)) {
    return Object.entries(args as Record<string, unknown>).map(([key, value]) => ({ key, value: show(value) }));
  }
  return args === null || args === undefined ? [] : [{ key: "args", value: show(args) }];
}

/** Most characters of the full parameter text shown when a card is expanded (a file body can be huge). */
export const MAX_FULL_ARG_CHARS = 20_000;

/**
 * The full parameters of a gated call as readable text: pretty JSON (a plain string stays
 * as it is), credential-shaped tokens redacted, capped. `""` when the call has none.
 * The card's one-line rows clip long values; this is what the expander shows.
 */
export function approvalFullArgs(args: unknown): string {
  if (args === null || args === undefined) return "";
  let text: string;
  if (typeof args === "string") text = args;
  else {
    try {
      text = JSON.stringify(args, null, 2) ?? String(args);
    } catch {
      text = String(args);
    }
  }
  const safe = redactSecrets(text);
  return safe.length > MAX_FULL_ARG_CHARS ? `${safe.slice(0, MAX_FULL_ARG_CHARS)}\n… (cut at ${MAX_FULL_ARG_CHARS} characters)` : safe;
}

/** True when the one-line rows lose something the full text shows (a clipped or multi-line value, or a nested one). */
export function approvalArgsNeedDetail(args: unknown): boolean {
  if (args === null || args === undefined) return false;
  const values = typeof args === "object" && !Array.isArray(args) ? Object.values(args as Record<string, unknown>) : [args];
  return values.some((v) => (typeof v === "string" ? v.length > MAX_ARG_CHARS || v.includes("\n") : v !== null && typeof v === "object"));
}

/** Server answer to starting a decision as a live turn. */
export type ApprovalStartResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: number; readonly error: string };

/**
 * Approve or deny a paused chat turn as a live turn: the server records the decision and answers
 * at once while the run goes on, so the page attaches to it (`chatStore.resumeActiveTurn`) and the
 * gated call and its result appear in the thread as they happen. Never throws.
 */
export async function startChatApproval(
  sessionId: string,
  runId: string,
  verb: Exclude<ApprovalVerb, "dismiss">,
  reason?: string,
  fetchFn: Fetch = (url, init) => fetch(url, init),
): Promise<ApprovalStartResult> {
  const url = `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(runId)}/${verb}/start`;
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reason?.trim() ? { reason: reason.trim() } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, status: res.status, error: body.error ?? `Request failed (${res.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
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
