import type { ChatTurn } from "./chat-store.js";
import { formatCost } from "@reactive-agents/ui-core";

/** Server-computed session totals (`GET /api/chat/sessions/:id` -> `totals`). */
export type ChatTotals = { tokens: number; costUsd: number; costKnown: boolean; tokensIn?: number; tokensOut?: number; splitComplete?: boolean };

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

/**
 * Session cost text. A known amount uses ui-core `formatCost` (the one cost
 * format; `<$0.0001`, never `$0.0000`); an unpriced or incomplete amount reads
 * as a lower bound (`≥ $0.012`), or `—` when nothing is known.
 */
export function formatSessionCost(usd: number, known: boolean): string {
  if (known) return formatCost(usd);
  return usd > 0 ? `≥ ${formatCost(usd)}` : "—";
}
