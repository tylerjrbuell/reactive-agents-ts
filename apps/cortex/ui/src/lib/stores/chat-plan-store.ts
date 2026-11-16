/**
 * The active chat session's plan (the framework `Plan`, persisted by the server with the session).
 * Held per session id so a switch never shows another conversation's plan. The card refreshes it
 * when it appears and when a turn ends; an edit goes through `savePlan`. Kept out of
 * `chat-store.ts` (one concern each).
 */
import { derived, get, writable } from "svelte/store";
import type { PlanWire } from "@reactive-agents/ui-core";
import { chatStore } from "./chat-store.js";
import { toast } from "./toast-store.js";
import { fetchSessionPlan, putSessionPlan } from "../plan-api.js";
import { toPlanBody, type DraftStep } from "../plan-edit.js";

/** Plans by session id; `null` = the server says there is none. */
const plans = writable<Readonly<Record<string, PlanWire | null>>>({});

/** The active session's plan; `undefined` until loaded, `null` when it has none. */
export const chatPlan = derived([chatStore, plans], ([$chat, $plans]): PlanWire | null | undefined =>
  $chat.activeSessionId === null ? undefined : $plans[$chat.activeSessionId],
);

/** Remember a session's plan (the server's answer to a read or an edit). */
export function setPlanFor(sessionId: string, plan: PlanWire | null): void {
  plans.update((p) => ({ ...p, [sessionId]: plan }));
}

/** Re-read the active session's plan. A failed read keeps what is shown. */
export async function refreshChatPlan(): Promise<void> {
  const sid = get(chatStore).activeSessionId;
  if (sid === null) return;
  const res = await fetchSessionPlan(sid);
  if (res.ok) setPlanFor(sid, res.plan);
}

/** Save the edited steps as the session's plan. Resolves true when the server recorded them. */
export async function savePlan(steps: readonly DraftStep[]): Promise<boolean> {
  const sid = get(chatStore).activeSessionId;
  if (sid === null) return false;
  const res = await putSessionPlan(sid, toPlanBody(steps));
  if (!res.ok) {
    toast.error("Could not save the plan", res.error);
    return false;
  }
  setPlanFor(sid, res.plan);
  return true;
}
