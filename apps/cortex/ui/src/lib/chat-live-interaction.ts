/**
 * A chat turn whose agent asked a question LIVE (`request_user_input`, no durable
 * runs): the run stays open and its stream sends `InteractionRequested` (runtime
 * HumanGate). The turn shows the question inline until the run moves on. Pure.
 *
 * The answer goes to `POST /api/runs/:runId/interaction`, the same route that
 * answers durable pauses (server `runner-service.ts` falls back to the live
 * registry, `durable-approvals.ts`), so this card, "Waiting on you" and the run
 * header are one answer.
 *
 * Framework gap (reported): the event carries no `timeoutMs`, so the card cannot
 * show how long the question waits.
 */
import type { UiStreamEvent } from "@reactive-agents/ui-core";
import { CORTEX_SERVER_URL } from "./constants.js";

/** The question a streaming chat turn is waiting on. */
export interface LiveInteraction {
  readonly runId: string;
  readonly interactionId: string;
  /** `form` | `choice` | `confirmation`; anything else gets a free-text reply box. */
  readonly kind: string;
  readonly prompt: string;
  readonly schema: unknown;
}

/** Events that mean the run moved past its wait (answered, or ended). */
const MOVED_ON: ReadonlySet<UiStreamEvent["_tag"]> = new Set([
  "ToolCallCompleted",
  "IterationProgress",
  "TextDelta",
  "StreamCompleted",
  "StreamError",
  "StreamCancelled",
]);

/**
 * The turn's live question after `event`: set by `InteractionRequested`, cleared once
 * the run moves on, unchanged otherwise (the same reference, so callers can skip a patch).
 * A tool call STARTING does not clear it: the ask is itself a tool call (`request_user_input`).
 */
export function liveInteractionAfter(current: LiveInteraction | undefined, event: UiStreamEvent): LiveInteraction | undefined {
  if (event._tag === "InteractionRequested") {
    return { runId: event.runId, interactionId: event.interactionId, kind: event.kind, prompt: event.prompt, schema: event.schema };
  }
  return current !== undefined && MOVED_ON.has(event._tag) ? undefined : current;
}

/**
 * The live questions of an open chat that no streaming turn shows: a wait the
 * app-wide list knows for `sessionId` (e.g. after a reload, when the turn's stream is
 * gone) that is not a streaming turn's own question. Rows from the server carry
 * `chatSessionId` for a chat's live questions.
 */
export function orphanChatInteractions(
  sessionId: string,
  pending: readonly (LiveInteraction & { readonly chatSessionId?: string })[],
  streamingRunIds: ReadonlySet<string>,
): LiveInteraction[] {
  return pending.filter((p) => p.chatSessionId === sessionId && !streamingRunIds.has(p.runId));
}

/** Answer a live question. `ok: false` carries the reason it was not delivered. */
export async function answerLiveInteraction(
  q: Pick<LiveInteraction, "runId" | "interactionId">,
  value: unknown,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(q.runId)}/interaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interactionId: q.interactionId, value }),
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: body.error ?? `Server returned ${res.status}` };
    if (body.success === false) return { ok: false, error: "The agent is no longer waiting for an answer." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
