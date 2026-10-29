import { Effect } from "effect";
import { emitErrorSwallowed } from "@reactive-agents/core";
import { detectToolCallShape } from "@reactive-agents/tools";
import type { ChatMessage } from "../chat.js";

/** Observability tag carried on the swallowed-error trace event when a reply is skipped. */
export const SHAPED_REPLY_SKIPPED_TAG = "ShapedAssistantReplySkipped";

/**
 * True when `content` is shaped like a failed tool call. The chat engine has no
 * tool-surface handle, so this uses the detector's structural checks only
 * (empty known-name list); legit JSON answers and prose are not shaped.
 */
export function isShapedAssistantReply(content: string, knownToolNames: Iterable<string> = []): boolean {
  return detectToolCallShape(content, knownToolNames).shaped;
}

/** Emit the observable swallowed-error event for dropped shaped exchange(s). */
function emitSkipped(site: string, dropped: number): void {
  void Effect.runPromise(
    emitErrorSwallowed({
      site,
      tag: SHAPED_REPLY_SKIPPED_TAG,
      message: `dropped ${dropped} shaped assistant turn(s) and their paired user turn(s) from model-visible history`,
    }),
  ).catch(() => {});
}

/**
 * Rows for one completed turn. A tool-call-shaped assistant reply (a failed
 * text tool call) records NOTHING: both the shaped reply and the user turn it
 * answered are dropped. Evidence (llama3.2:3b): any leftover odd assistant turn
 * (the shaped text, an omission placeholder, "(no response)") re-primes the
 * failure 8/10; a clean history 0/10. Dropping the pair keeps strict
 * user/assistant alternation. Emits `ErrorSwallowed` tagged
 * {@link SHAPED_REPLY_SKIPPED_TAG} (no-op without an EventBus).
 */
export function recordedTurnPair(userContent: string, assistantContent: string): ChatMessage[] {
  if (isShapedAssistantReply(assistantContent)) {
    emitSkipped("runtime/chat/history-hygiene.ts:recordedTurnPair", 1);
    return [];
  }
  return [
    { role: "user", content: userContent, timestamp: Date.now() },
    { role: "assistant", content: assistantContent, timestamp: Date.now() },
  ];
}

/**
 * Heal an already-contaminated history: each shaped assistant row is removed
 * together with the user row it answered (same semantic as Cortex
 * `turnsToChatMessages`), preserving alternation. Pure; never mutates the
 * input; returns the input itself when nothing is shaped.
 */
export function healShapedAssistantTurns(history: readonly ChatMessage[]): readonly ChatMessage[] {
  if (!history.some((m) => m.role === "assistant" && isShapedAssistantReply(m.content))) return history;
  const out: ChatMessage[] = [];
  let dropped = 0;
  for (const m of history) {
    if (m.role === "assistant" && isShapedAssistantReply(m.content)) {
      if (out.length > 0 && out[out.length - 1]!.role === "user") out.pop();
      dropped++;
    } else {
      out.push(m);
    }
  }
  emitSkipped("runtime/chat/history-hygiene.ts:healShapedAssistantTurns", dropped);
  return out;
}
