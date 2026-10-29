import { Effect } from "effect";
import { emitErrorSwallowed } from "@reactive-agents/core";
import { detectToolCallShape } from "@reactive-agents/tools";
import type { ChatMessage } from "../chat.js";

/**
 * Stand-in recorded/rendered for an assistant reply that was tool-call-shaped
 * (a failed text tool call). DECISION: keep the paired user turn and replace
 * only the assistant content with this neutral marker, rather than dropping
 * either turn. This preserves strict user/assistant alternation (no orphan
 * user turn, no consecutive same-role rows), keeps the user's request visible
 * as context, and never lets raw call JSON re-enter history where the model
 * would imitate it. The marker is deliberately not call-shaped itself.
 */
export const SHAPED_REPLY_PLACEHOLDER =
  "[Previous reply was an unexecuted tool-call attempt and was omitted.]";

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

/**
 * Guard one assistant reply before it is recorded. Shaped replies are replaced
 * by {@link SHAPED_REPLY_PLACEHOLDER} and an `ErrorSwallowed` event tagged
 * {@link SHAPED_REPLY_SKIPPED_TAG} is emitted (no-op without an EventBus).
 */
export function guardAssistantReply(content: string): string {
  if (!isShapedAssistantReply(content)) return content;
  void Effect.runPromise(
    emitErrorSwallowed({ site: "runtime/chat/history-hygiene.ts:guardAssistantReply", tag: SHAPED_REPLY_SKIPPED_TAG }),
  ).catch(() => {});
  return SHAPED_REPLY_PLACEHOLDER;
}

/** Symmetric user + assistant rows for one completed turn, assistant reply guarded. */
export function recordedTurnPair(userContent: string, assistantContent: string): ChatMessage[] {
  return [
    { role: "user", content: userContent, timestamp: Date.now() },
    { role: "assistant", content: guardAssistantReply(assistantContent), timestamp: Date.now() },
  ];
}

/**
 * Heal an already-contaminated history for rendering: shaped assistant rows
 * become {@link SHAPED_REPLY_PLACEHOLDER}; everything else passes through by
 * reference. Pure; never mutates the input.
 */
export function healShapedAssistantTurns(history: readonly ChatMessage[]): readonly ChatMessage[] {
  return history.map((m) =>
    m.role === "assistant" && isShapedAssistantReply(m.content) ? { ...m, content: SHAPED_REPLY_PLACEHOLDER } : m,
  );
}
