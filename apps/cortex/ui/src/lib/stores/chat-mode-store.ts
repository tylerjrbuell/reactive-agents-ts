/**
 * The active chat session's mode (plan | execute). The server owns it (stored with the session);
 * this store reads it from the session list and keeps what the user just set until the list
 * catches up, so the toggle never flickers. Kept out of `chat-store.ts` (one concern each).
 */
import { derived, get, writable } from "svelte/store";
import { CORTEX_SERVER_URL } from "$lib/constants.js";
import { chatStore } from "./chat-store.js";
import { toast } from "./toast-store.js";
import type { ChatMode } from "../chat-mode.js";
import { EXECUTE_MESSAGE } from "../plan-command.js";
import type { DraftStep } from "../plan-edit.js";
import { savePlan } from "./chat-plan-store.js";

/** Modes the user set in this page, by session id (wins over the list until a reload). */
const chosen = writable<Readonly<Record<string, ChatMode>>>({});

/** The active session's mode; execute when none is active. */
export const chatMode = derived([chatStore, chosen], ([$chat, $chosen]): ChatMode => {
  const sid = $chat.activeSessionId;
  if (sid === null) return "execute";
  return $chosen[sid] ?? $chat.sessions.find((s) => s.sessionId === sid)?.mode ?? "execute";
});

function fail(sid: string, previous: ChatMode, reason: string): false {
  chosen.update((c) => ({ ...c, [sid]: previous }));
  toast.error("Could not switch mode", reason);
  return false;
}

/**
 * Switch the active session's mode: optimistic, stored server-side, reverted with a toast when
 * the server refuses. Resolves true when the session is in `mode` afterwards.
 */
export async function setChatMode(mode: ChatMode): Promise<boolean> {
  const sid = get(chatStore).activeSessionId;
  if (sid === null) return false;
  const previous = get(chatMode);
  if (previous === mode) return true;
  chosen.update((c) => ({ ...c, [sid]: mode }));
  try {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sid)}/mode`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return fail(sid, previous, body.error ?? `HTTP ${res.status}`);
    }
    return true;
  } catch (e) {
    return fail(sid, previous, String(e));
  }
}

/**
 * The plan card's Execute action: record the user's edited steps as the session's plan (the
 * framework `session.setPlan`, so the next turn seeds from them), switch to Execute, then send the
 * follow-up turn in one step. `edited` is absent when the plan was not changed. A plan the server
 * refuses stops here, with its toast: nothing executes a plan the user did not see recorded.
 */
export async function executePlan(edited?: readonly DraftStep[]): Promise<void> {
  if (edited !== undefined && !(await savePlan(edited))) return;
  if (await setChatMode("execute")) await chatStore.sendMessageStream(EXECUTE_MESSAGE);
}
