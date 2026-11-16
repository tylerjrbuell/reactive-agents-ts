/**
 * Calls for a chat session's plan (`GET` / `PUT /api/chat/sessions/:id/plan`). The server reads and
 * edits the framework `Plan` (`session.plan` / `session.setPlan`); these only carry it.
 */
import type { PlanWire } from "@reactive-agents/ui-core";
import { CORTEX_SERVER_URL } from "./constants.js";
import type { PlanStepBody } from "./plan-edit.js";

/** A plan call's result: the plan (`null` while the session has none) or a person-readable reason. */
export type PlanResult = { readonly ok: true; readonly plan: PlanWire | null } | { readonly ok: false; readonly error: string };

const url = (sessionId: string): string => `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/plan`;

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

/** Replace the session's plan with the edited steps (a user edit: the next turn seeds from it). */
export async function putSessionPlan(sessionId: string, steps: readonly PlanStepBody[]): Promise<PlanResult> {
  try {
    return await settle(await fetch(url(sessionId), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steps }) }));
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
