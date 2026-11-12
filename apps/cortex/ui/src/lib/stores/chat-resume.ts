/**
 * Resuming a chat turn that kept running on the server after its page was closed or
 * reloaded. A streamed turn is detached from the connection that started it
 * (server `chat-detached-turn.ts`), so a turn waiting on an approval or a question
 * is still there when the page comes back: ask the server what is running, draw the
 * turn's two bubbles, and attach to its event stream (replayed from the start, then
 * live), which brings back the pending card and the rest of the reply. Pure helpers
 * plus one fetch; the store does the wiring.
 */
import { CORTEX_SERVER_URL } from "../constants.js";
import type { ChatTurn } from "./chat-store.js";

/** What the server reports for a session's running turn. */
export interface ActiveTurnInfo {
  /** The user message the turn answers (stored with the turn only when it ends). */
  readonly message: string;
  /** Epoch ms the turn started. */
  readonly startedAt: number;
}

/** The URL a turn's stream is sent from (POST) and attached to (GET `…/stream/active?cursor=`). */
export const chatStreamEndpoint = (sessionId: string): string =>
  `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/chat/stream`;

/** The attach target of {@link chatStreamEndpoint}: the session's running (or just finished) turn. */
export const ATTACH_ACTIVE_TURN = { runId: "active" } as const;

/** The session's running turn; `undefined` when none is running or the server did not say. Never throws. */
export async function fetchActiveTurn(sessionId: string, fetchFn: typeof fetch = fetch): Promise<ActiveTurnInfo | undefined> {
  try {
    const res = await fetchFn(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/chat/active`);
    if (!res.ok) return undefined;
    const body = (await res.json()) as { active?: boolean; message?: unknown; startedAt?: unknown };
    if (body.active !== true || typeof body.message !== "string") return undefined;
    return { message: body.message, startedAt: typeof body.startedAt === "number" ? body.startedAt : Date.now() };
  } catch {
    return undefined;
  }
}

/**
 * The two bubbles a resumed turn is drawn into: the user's message and a streaming
 * assistant turn (waiting on the model until the replayed events say otherwise).
 * `runModel` is the model pinned for the turn, as `sendMessageStream` does.
 */
export function resumedTurns(
  info: ActiveTurnInfo,
  now: number,
  runModel: { readonly provider?: string; readonly model?: string } = {},
): { readonly user: ChatTurn; readonly assistant: ChatTurn } {
  return {
    user: { id: now, role: "user", content: info.message, tokensUsed: 0, ts: info.startedAt },
    assistant: {
      id: now + 1,
      role: "assistant",
      content: "",
      tokensUsed: 0,
      ts: info.startedAt,
      streaming: true,
      awaitingModelSince: now,
      ...runModel,
    },
  };
}

/**
 * Whether the page should attach to a running turn: the server has one and this
 * page is not already streaming a turn of its own (or one it resumed).
 */
export function shouldResume(info: ActiveTurnInfo | undefined, state: { readonly sending: boolean; readonly turns: readonly ChatTurn[] }): info is ActiveTurnInfo {
  if (info === undefined || state.sending) return false;
  return !state.turns.some((t) => t.streaming === true);
}
