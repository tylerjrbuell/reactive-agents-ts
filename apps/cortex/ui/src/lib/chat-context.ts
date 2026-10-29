import type { ChatContext, ChatTurn } from "./stores/chat-store.js";

/** Newest context-window reading across a conversation, so the ring keeps showing it while idle or mid-run. */
export function latestContext(turns: readonly ChatTurn[]): ChatContext | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const c = turns[i]?.context;
    if (c) return c;
  }
  return undefined;
}

/**
 * Adopt freshly fetched server turns without losing a live reading the server
 * has not persisted (older rows, or a stream that ended before the write):
 * when none of the new turns carries one, the previous reading rides on the last assistant turn.
 */
export function carryContext(previous: readonly ChatTurn[], next: readonly ChatTurn[]): ChatTurn[] {
  if (latestContext(next)) return [...next];
  const kept = latestContext(previous);
  if (!kept) return [...next];
  const idx = next.map((t) => t.role).lastIndexOf("assistant");
  if (idx < 0) return [...next];
  return next.map((t, i) => (i === idx ? { ...t, context: kept } : t));
}
