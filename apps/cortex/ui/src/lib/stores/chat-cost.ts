import type { ChatTurn } from "./chat-store.js";

/** Server-computed session totals (`GET /api/chat/sessions/:id` -> `totals`). */
export type ChatTotals = { tokens: number; costUsd: number; costKnown: boolean };

/**
 * Session usage for display: the server totals (the one persisted source) plus the
 * live counters of a turn still streaming. A streaming turn is not yet in the totals,
 * so completed turns are never re-added here.
 */
export function sessionCostSummary(totals: ChatTotals | undefined, turns: readonly ChatTurn[]): ChatTotals {
  const base: ChatTotals = totals ?? { tokens: 0, costUsd: 0, costKnown: true };
  let tokens = base.tokens;
  let costUsd = base.costUsd;
  for (const t of turns) {
    if (!t.streaming) continue;
    tokens += t.liveTokens ?? 0;
    costUsd += t.liveCost ?? 0;
  }
  return { tokens, costUsd, costKnown: base.costKnown };
}

/** "$0.0123"; "≥ $0.0123" when only a lower bound; "—" when unpriced and nothing is known. */
export function formatCost(usd: number, known: boolean): string {
  if (known) return `$${usd.toFixed(4)}`;
  return usd > 0 ? `≥ $${usd.toFixed(4)}` : "—";
}
