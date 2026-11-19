import { addCost, type CostSum, type PriceSource } from "@reactive-agents/core";
import type { StoredTurnTrace } from "./chat-turn-trace.js";

/** What a chat turn cost, and whether that figure can be trusted as complete. */
export interface TurnCost {
  readonly usd: number;
  /** `false` = unpriced, or a lower bound (a failed sub-agent's spend is not folded by the runtime). */
  readonly known: boolean;
}

/** Tools that delegate to a sub-agent (mirrors `SUBAGENT_TOOL_NAMES` in `@reactive-agents/runtime`). */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(["spawn-agent", "spawn-agents"]);

/**
 * Cost of one completed turn. A missing cost is unknown (never silently $0). A turn
 * with a failed delegation is a lower bound: the runtime's budget fold does not count
 * a failed child's spend, so the figure may understate and is flagged rather than hidden.
 * `complete: false` (a call had no known price: framework `costComplete`, or an
 * unpriced `TokenUsage`) keeps the dollars as a lower bound and flags it the same way.
 */
export function turnCostOf(cost: number | undefined, trace: StoredTurnTrace | undefined, complete = true): TurnCost {
  if (typeof cost !== "number" || !Number.isFinite(cost)) return { usd: 0, known: false };
  const failedChild = trace?.toolCalls.some((c) => c.status === "failed" && SUBAGENT_TOOLS.has(c.name)) ?? false;
  return { usd: cost, known: complete && !failedChild };
}

/**
 * Fold one streamed `TokenUsage` cost into a running sum (start from core
 * `EMPTY_COST_SUM`). An unpriced call (`costUsd` absent, or `priceSource:
 * "unknown"`) adds nothing and marks the sum incomplete (core `addCost`).
 */
export function addUsageCost(sum: CostSum, usage: { readonly costUsd?: number; readonly priceSource?: PriceSource }): CostSum {
  return addCost(sum, usage.priceSource === "unknown" ? undefined : usage.costUsd);
}

/**
 * Cost of a turn that never completed, from the `TokenUsage` calls it reported.
 * Nothing reported at all is unknown; an incomplete sum is a lower bound.
 */
export function reportedTurnCostOf(sum: CostSum, trace: StoredTurnTrace | undefined): TurnCost {
  return turnCostOf(sum.usd > 0 || !sum.complete ? sum.usd : undefined, trace, sum.complete);
}

/**
 * `StreamCompleted.metadata` for a direct (tools-off) chat reply. A reply with no
 * cost, or with `costComplete: false` (runtime `ChatReply`), carries
 * `costComplete: false`: `cost` is then a lower bound (0 when nothing was priced),
 * the framework's own convention, never a silent $0-complete.
 */
export function directReplyMetadata(reply: {
  readonly cost?: number;
  readonly costComplete?: boolean;
  readonly tokens?: number;
  readonly steps?: number;
}): { tokensUsed: number; cost: number; costComplete?: false; stepsCount: number; duration: number } {
  const cost = reply.cost;
  const priced = typeof cost === "number" && Number.isFinite(cost);
  return {
    tokensUsed: reply.tokens ?? 0,
    cost: priced ? cost : 0,
    ...(!priced || reply.costComplete === false ? { costComplete: false as const } : {}),
    stepsCount: reply.steps ?? 0,
    duration: 0,
  };
}

/** Cost of a completed turn from its result metadata (`cost`, framework `costComplete`). */
export function completedTurnCostOf(
  meta: { readonly cost?: number; readonly costComplete?: boolean } | undefined,
  trace: StoredTurnTrace | undefined,
): TurnCost {
  return turnCostOf(meta?.cost, trace, meta?.costComplete !== false);
}
