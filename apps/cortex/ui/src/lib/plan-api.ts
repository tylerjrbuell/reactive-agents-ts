/**
 * Calls for a chat session's plan (`GET` / `PUT /api/chat/sessions/:id/plan`, `.../plan/export`,
 * `.../plan/parse`). The server reads and edits the framework `Plan` (`session.plan` /
 * `session.setPlan`) and writes and reads its portable formats; these only carry it.
 */
import type { PlanWire } from "@reactive-agents/ui-core";
import { CORTEX_SERVER_URL } from "./constants.js";
import type { PlanStepBody } from "./plan-edit.js";

/** A plan call's result: the plan (`null` while the session has none) or a person-readable reason. */
export type PlanResult = { readonly ok: true; readonly plan: PlanWire | null } | { readonly ok: false; readonly error: string };

const url = (sessionId: string, suffix = ""): string => `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/plan${suffix}`;

async function settle(res: Response): Promise<PlanResult> {
  const body = (await res.json().catch(() => ({}))) as { plan?: PlanWire | null; error?: string };
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  return { ok: true, plan: body.plan ?? null };
}

/** The session's persisted plan. */
export async function fetchSessionPlan(sessionId: string): Promise<PlanResult> {
  try {
    return await settle(await fetch(url(sessionId)));
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Replace the session's plan with the edited steps (a user edit: the next turn seeds from it). A `goal` replaces the plan's goal too (an imported plan). */
export async function putSessionPlan(sessionId: string, steps: readonly PlanStepBody[], goal?: string): Promise<PlanResult> {
  try {
    return await settle(
      await fetch(url(sessionId), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steps, ...(goal !== undefined ? { goal } : {}) }) }),
    );
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** A format the saved plan can be exported in (server `PlanExportFormat`). */
export type PlanFormat = "markdown" | "html" | "json";

/** An exported plan: its text, the server's file name and media type. */
export type PlanExportResult = { readonly ok: true; readonly text: string; readonly filename: string; readonly mime: string } | { readonly ok: false; readonly error: string };

/** The session's saved plan as a document in `format`. */
export async function exportSessionPlan(sessionId: string, format: PlanFormat): Promise<PlanExportResult> {
  try {
    const res = await fetch(url(sessionId, `/export?format=${format}`));
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    const filename = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `plan.${format === "markdown" ? "md" : format}`;
    return { ok: true, text: await res.text(), filename, mime: res.headers.get("content-type") ?? "text/plain" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Why a plan could not be read (server `PlanImportFailure`; the framework's `PlanParseReason`). */
export type PlanParseReasonWire = "no-steps" | "invalid-json" | "invalid-shape" | "unsupported-version";

/** The result of reading pasted or uploaded plan text. Nothing is saved by it. */
export type PlanParseResult = { readonly ok: true; readonly plan: PlanWire } | { readonly ok: false; readonly error: string; readonly reason?: PlanParseReasonWire };

/** Read Markdown or a JSON envelope as a plan (the server uses the framework's parsers). */
export async function parseSessionPlan(sessionId: string, text: string): Promise<PlanParseResult> {
  try {
    const res = await fetch(url(sessionId, "/parse"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const body = (await res.json().catch(() => ({}))) as { plan?: PlanWire; error?: string; reason?: PlanParseReasonWire };
    if (!res.ok || body.plan === undefined) return { ok: false, error: body.error ?? `HTTP ${res.status}`, ...(body.reason !== undefined ? { reason: body.reason } : {}) };
    return { ok: true, plan: body.plan };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
